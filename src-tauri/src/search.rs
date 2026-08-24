use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::vault::{NoteDocument, NoteEntry, VaultEngine, VaultError, INTERNAL_DIR};

const MATCH_START: char = '\u{e000}';
const MATCH_END: char = '\u{e001}';

#[derive(Debug, Error)]
pub enum SearchError {
    #[error(transparent)]
    Vault(#[from] VaultError),
    #[error("search database failed: {0}")]
    Database(#[from] rusqlite::Error),
    #[error("search storage failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SearchSpan {
    pub text: String,
    pub matched: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub relative_path: String,
    pub title: String,
    pub snippet: Vec<SearchSpan>,
    pub rank: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexSummary {
    pub indexed_notes: usize,
    pub updated_notes: usize,
    pub removed_notes: usize,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct IndexStatus {
    pub ready: bool,
    pub indexed_notes: usize,
    pub updated_ms: u64,
}

#[derive(Clone, Debug)]
pub struct SearchIndex {
    vault: VaultEngine,
    database_path: PathBuf,
}

#[derive(Clone, Copy)]
struct StoredNote {
    modified_ms: u64,
    byte_length: u64,
}

impl SearchIndex {
    pub fn open(vault: VaultEngine) -> Result<Self, SearchError> {
        let database_path = vault.root().join(INTERNAL_DIR).join("index.db");
        fs::create_dir_all(
            database_path
                .parent()
                .expect("index database always has a parent"),
        )?;
        Ok(Self {
            vault,
            database_path,
        })
    }

    pub fn database_path(&self) -> &Path {
        &self.database_path
    }

    pub fn rebuild(&self) -> Result<IndexSummary, SearchError> {
        let started = Instant::now();
        let notes = self.vault.list_notes()?;
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM note_search", [])?;
        transaction.execute("DELETE FROM note_index_state", [])?;

        for entry in &notes {
            let document = self.vault.read_note(&entry.relative_path)?;
            upsert_document(&transaction, entry, &document)?;
        }
        set_updated_ms(&transaction)?;
        transaction.commit()?;
        checkpoint(&connection)?;

        Ok(IndexSummary {
            indexed_notes: notes.len(),
            updated_notes: notes.len(),
            removed_notes: 0,
            duration_ms: elapsed_ms(started),
        })
    }

    pub fn sync(&self) -> Result<IndexSummary, SearchError> {
        let started = Instant::now();
        let notes = self.vault.list_notes()?;
        let mut connection = self.connection()?;
        let stored = stored_notes(&connection)?;
        let current_paths: HashSet<&str> = notes
            .iter()
            .map(|note| note.relative_path.as_str())
            .collect();
        let removed: Vec<String> = stored
            .keys()
            .filter(|path| !current_paths.contains(path.as_str()))
            .cloned()
            .collect();
        let changed: Vec<&NoteEntry> = notes
            .iter()
            .filter(|note| {
                stored.get(&note.relative_path).is_none_or(|saved| {
                    saved.modified_ms != note.modified_ms || saved.byte_length != note.byte_length
                })
            })
            .collect();

        let transaction = connection.transaction()?;
        for path in &removed {
            remove_document(&transaction, path)?;
        }
        for entry in &changed {
            let document = self.vault.read_note(&entry.relative_path)?;
            upsert_document(&transaction, entry, &document)?;
        }
        set_updated_ms(&transaction)?;
        transaction.commit()?;
        checkpoint(&connection)?;

        Ok(IndexSummary {
            indexed_notes: notes.len(),
            updated_notes: changed.len(),
            removed_notes: removed.len(),
            duration_ms: elapsed_ms(started),
        })
    }

    pub fn update_path(&self, relative_path: &str, _kind: &str) -> Result<(), SearchError> {
        let mut connection = self.connection()?;
        let transaction = connection.transaction()?;
        match self.vault.read_note(relative_path) {
            Ok(document) => {
                let entry = NoteEntry {
                    relative_path: document.relative_path.clone(),
                    file_name: Path::new(&document.relative_path)
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or(&document.relative_path)
                        .to_owned(),
                    byte_length: document.content.len() as u64,
                    modified_ms: document.modified_ms,
                };
                upsert_document(&transaction, &entry, &document)?;
            }
            Err(VaultError::NoteNotFound) => remove_document(&transaction, relative_path)?,
            Err(error) => return Err(error.into()),
        }
        set_updated_ms(&transaction)?;
        transaction.commit()?;
        checkpoint(&connection)?;
        Ok(())
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchResult>, SearchError> {
        let Some(compiled) = compile_query(query) else {
            return Ok(Vec::new());
        };
        let connection = self.connection()?;
        let mut statement = connection.prepare(
            "SELECT relative_path,
                    file_name,
                    snippet(note_search, -1, '\u{e000}', '\u{e001}', ' … ', 28),
                    bm25(note_search, 7.0, 8.0, 1.0, 2.0, 2.0, 1.5, 2.5, 3.0)
               FROM note_search
              WHERE note_search MATCH ?1
              ORDER BY 4
              LIMIT ?2",
        )?;
        let rows = statement.query_map(params![compiled, limit.clamp(1, 200) as i64], |row| {
            let relative_path: String = row.get(0)?;
            let file_name: String = row.get(1)?;
            let raw_snippet: String = row.get(2)?;
            Ok(SearchResult {
                relative_path,
                title: file_name
                    .strip_suffix(".md")
                    .or_else(|| file_name.strip_suffix(".MD"))
                    .unwrap_or(&file_name)
                    .to_owned(),
                snippet: parse_snippet(&raw_snippet),
                rank: row.get(3)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn status(&self) -> Result<IndexStatus, SearchError> {
        if !self.database_path.exists() {
            return Ok(IndexStatus {
                ready: false,
                indexed_notes: 0,
                updated_ms: 0,
            });
        }
        let connection = self.connection()?;
        let indexed_notes =
            connection.query_row("SELECT count(*) FROM note_index_state", [], |row| {
                row.get::<_, i64>(0)
            })? as usize;
        let updated_ms = connection
            .query_row(
                "SELECT value FROM search_meta WHERE key = 'updated_ms'",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .and_then(|value| value.parse().ok())
            .unwrap_or(0);
        Ok(IndexStatus {
            ready: true,
            indexed_notes,
            updated_ms,
        })
    }

    fn connection(&self) -> Result<Connection, SearchError> {
        let connection = Connection::open(&self.database_path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        connection.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA temp_store = MEMORY;
             CREATE TABLE IF NOT EXISTS note_index_state (
                 relative_path TEXT PRIMARY KEY,
                 modified_ms INTEGER NOT NULL,
                 byte_length INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS search_meta (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );
             CREATE VIRTUAL TABLE IF NOT EXISTS note_search USING fts5(
                 relative_path,
                 file_name,
                 body,
                 headings,
                 tags,
                 frontmatter,
                 tasks,
                 attachments,
                 tokenize = 'unicode61 remove_diacritics 2'
             );",
        )?;
        Ok(connection)
    }
}

fn stored_notes(connection: &Connection) -> Result<HashMap<String, StoredNote>, rusqlite::Error> {
    let mut statement = connection
        .prepare("SELECT relative_path, modified_ms, byte_length FROM note_index_state")?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            StoredNote {
                modified_ms: row.get::<_, i64>(1)? as u64,
                byte_length: row.get::<_, i64>(2)? as u64,
            },
        ))
    })?;
    rows.collect()
}

fn upsert_document(
    transaction: &Transaction<'_>,
    entry: &NoteEntry,
    document: &NoteDocument,
) -> Result<(), rusqlite::Error> {
    let extracted = extract_markdown(&document.content);
    transaction.execute(
        "DELETE FROM note_search WHERE relative_path = ?1",
        [&entry.relative_path],
    )?;
    transaction.execute(
        "INSERT INTO note_search (
             relative_path, file_name, body, headings, tags, frontmatter, tasks, attachments
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.relative_path,
            entry.file_name,
            document.content,
            extracted.headings,
            extracted.tags,
            extracted.frontmatter,
            extracted.tasks,
            extracted.attachments,
        ],
    )?;
    transaction.execute(
        "INSERT INTO note_index_state (relative_path, modified_ms, byte_length)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(relative_path) DO UPDATE SET
             modified_ms = excluded.modified_ms,
             byte_length = excluded.byte_length",
        params![
            entry.relative_path,
            entry.modified_ms as i64,
            entry.byte_length as i64,
        ],
    )?;
    Ok(())
}

fn remove_document(
    transaction: &Transaction<'_>,
    relative_path: &str,
) -> Result<(), rusqlite::Error> {
    transaction.execute(
        "DELETE FROM note_search WHERE relative_path = ?1",
        [relative_path],
    )?;
    transaction.execute(
        "DELETE FROM note_index_state WHERE relative_path = ?1",
        [relative_path],
    )?;
    Ok(())
}

fn set_updated_ms(transaction: &Transaction<'_>) -> Result<(), rusqlite::Error> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u64::MAX as u128) as u64;
    transaction.execute(
        "INSERT INTO search_meta (key, value) VALUES ('updated_ms', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [now.to_string()],
    )?;
    Ok(())
}

fn checkpoint(connection: &Connection) -> Result<(), rusqlite::Error> {
    connection.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
}

#[derive(Default)]
struct ExtractedMarkdown {
    headings: String,
    tags: String,
    frontmatter: String,
    tasks: String,
    attachments: String,
}

fn extract_markdown(content: &str) -> ExtractedMarkdown {
    let mut result = ExtractedMarkdown::default();
    let lines: Vec<&str> = content.lines().collect();

    if lines.first().is_some_and(|line| line.trim() == "---") {
        if let Some(end) = lines
            .iter()
            .enumerate()
            .skip(1)
            .find_map(|(index, line)| (line.trim() == "---").then_some(index))
        {
            result.frontmatter = lines[1..end].join("\n");
        }
    }

    let mut headings = Vec::new();
    let mut tasks = Vec::new();
    let mut tags = HashSet::new();
    for line in &lines {
        let trimmed = line.trim_start();
        let hashes = trimmed.bytes().take_while(|byte| *byte == b'#').count();
        if (1..=6).contains(&hashes) && trimmed.as_bytes().get(hashes) == Some(&b' ') {
            headings.push(trimmed[hashes + 1..].trim());
        }
        if let Some((finished, text)) = task_text(trimmed) {
            tasks.push(format!(
                "{} {}",
                if finished { "finished" } else { "unfinished" },
                text
            ));
        }
        collect_tags(line, &mut tags);
    }
    result.headings = headings.join("\n");
    result.tasks = tasks.join("\n");
    let mut sorted_tags: Vec<_> = tags.into_iter().collect();
    sorted_tags.sort();
    result.tags = sorted_tags.join(" ");
    result.attachments = attachment_names(content).join("\n");
    result
}

fn task_text(line: &str) -> Option<(bool, &str)> {
    let rest = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .or_else(|| line.strip_prefix("+ "))?;
    if let Some(text) = rest.strip_prefix("[ ] ") {
        return Some((false, text.trim()));
    }
    rest.strip_prefix("[x] ")
        .or_else(|| rest.strip_prefix("[X] "))
        .map(|text| (true, text.trim()))
}

fn collect_tags(line: &str, tags: &mut HashSet<String>) {
    let characters: Vec<char> = line.chars().collect();
    for (index, character) in characters.iter().enumerate() {
        if *character != '#' || index + 1 >= characters.len() {
            continue;
        }
        let previous_allows_tag = index == 0
            || characters[index - 1].is_whitespace()
            || matches!(characters[index - 1], '(' | '[' | '{');
        if !previous_allows_tag || !characters[index + 1].is_alphanumeric() {
            continue;
        }
        let value: String = characters[index + 1..]
            .iter()
            .take_while(|value| value.is_alphanumeric() || matches!(value, '-' | '_' | '/'))
            .collect();
        if !value.is_empty() {
            tags.insert(value);
        }
    }
}

fn attachment_names(content: &str) -> Vec<String> {
    let mut names = HashSet::new();
    let mut remainder = content;
    while let Some(start) = remainder.find("](") {
        remainder = &remainder[start + 2..];
        let Some(end) = remainder.find(')') else {
            break;
        };
        let destination = remainder[..end].trim().trim_matches('<').trim_matches('>');
        remainder = &remainder[end + 1..];
        if destination.starts_with("http:")
            || destination.starts_with("https:")
            || destination.starts_with("data:")
            || destination.starts_with('#')
        {
            continue;
        }
        let without_query = destination.split(['?', '#']).next().unwrap_or(destination);
        if let Some(name) = without_query.rsplit(['/', '\\']).next() {
            if !name.is_empty() {
                names.insert(name.to_owned());
            }
        }
    }
    let mut names: Vec<_> = names.into_iter().collect();
    names.sort();
    names
}

fn compile_query(query: &str) -> Option<String> {
    let terms: Vec<String> = query
        .split(|character: char| {
            !character.is_alphanumeric() && character != '_' && character != '-'
        })
        .filter(|term| !term.is_empty())
        .map(|term| format!("\"{}\"*", term.replace('"', "\"\"")))
        .collect();
    (!terms.is_empty()).then(|| terms.join(" AND "))
}

fn parse_snippet(snippet: &str) -> Vec<SearchSpan> {
    let mut spans = Vec::new();
    let mut matched = false;
    for piece in snippet.split_inclusive([MATCH_START, MATCH_END]) {
        let (text, marker) = if let Some(text) = piece.strip_suffix(MATCH_START) {
            (text, Some(true))
        } else if let Some(text) = piece.strip_suffix(MATCH_END) {
            (text, Some(false))
        } else {
            (piece, None)
        };
        if !text.is_empty() {
            spans.push(SearchSpan {
                text: text.to_owned(),
                matched,
            });
        }
        if let Some(next) = marker {
            matched = next;
        }
    }
    if spans.is_empty() {
        spans.push(SearchSpan {
            text: snippet.to_owned(),
            matched: false,
        });
    }
    spans
}

fn elapsed_ms(started: Instant) -> u64 {
    started.elapsed().as_millis().min(u64::MAX as u128) as u64
}

#[cfg(test)]
mod tests {
    use super::{compile_query, extract_markdown, parse_snippet};

    #[test]
    fn query_compilation_is_literal_and_prefix_friendly() {
        assert_eq!(
            compile_query("warning signs"),
            Some("\"warning\"* AND \"signs\"*".to_owned())
        );
        assert_eq!(compile_query("   "), None);
    }

    #[test]
    fn markdown_extraction_keeps_searchable_structures_separate() {
        let extracted = extract_markdown(
            "---\ntag: medicine\n---\n## Signs\n- [ ] Review\n#project-aurora [PDF](../Attachments/a.pdf)",
        );
        assert_eq!(extracted.frontmatter, "tag: medicine");
        assert_eq!(extracted.headings, "Signs");
        assert_eq!(extracted.tasks, "unfinished Review");
        assert_eq!(extracted.tags, "project-aurora");
        assert_eq!(extracted.attachments, "a.pdf");
    }

    #[test]
    fn snippet_markers_become_safe_structured_spans() {
        let spans = parse_snippet("before \u{e000}match\u{e001} after");
        assert_eq!(spans.len(), 3);
        assert!(spans[1].matched);
        assert_eq!(spans[1].text, "match");
    }
}
