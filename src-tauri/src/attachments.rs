use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
};

use percent_encoding::{percent_decode_str, utf8_percent_encode, AsciiSet, CONTROLS};
use regex::{Captures, Regex};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use walkdir::WalkDir;

use crate::vault::{
    atomic_replace, portable_path, temporary_sibling, validate_relative_entry_path,
    validate_relative_note_path, NoteDocument, SaveOutcome, VaultEngine, VaultError, INTERNAL_DIR,
};

const DEFAULT_ATTACHMENT_DIRECTORY: &str = "Attachments";
const COPY_BUFFER_BYTES: usize = 1024 * 1024;
const MARKDOWN_URL_ENCODE: &AsciiSet = &CONTROLS
    .add(b' ')
    .add(b'%')
    .add(b'#')
    .add(b'(')
    .add(b')')
    .add(b'<')
    .add(b'>')
    .add(b'"')
    .add(b'\\');
static ATTACHMENT_OPERATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static MARKDOWN_LINK: OnceLock<Regex> = OnceLock::new();

#[derive(Debug, Error)]
pub enum AttachmentError {
    #[error(transparent)]
    Vault(#[from] VaultError),
    #[error("attachment source is unavailable or is not a file")]
    SourceUnavailable,
    #[error("attachment path must stay inside the configured attachment directory")]
    OutsideAttachmentDirectory,
    #[error("attachment filename is not usable")]
    InvalidFileName,
    #[error("attachment metadata is unavailable: {0}")]
    Catalog(#[from] serde_json::Error),
    #[error("attachment reference changed before it could be repaired")]
    RepairConflict,
    #[error("attachment operation could not be rolled back safely")]
    RollbackFailed,
    #[error("filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentSettings {
    pub directory: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentImport {
    pub relative_path: String,
    pub markdown: String,
    pub display_name: String,
    pub created: bool,
    pub rollback_token: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentMoveResult {
    pub relative_path: String,
    pub updated_notes: Vec<NoteDocument>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentIssue {
    pub note_path: String,
    pub broken_target: String,
    pub suggested_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentInventoryEntry {
    pub relative_path: String,
    pub byte_length: u64,
    pub referenced: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct CatalogEntry {
    hash: String,
    byte_length: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct AttachmentCatalog {
    #[serde(default = "default_attachment_directory")]
    directory: String,
    #[serde(default)]
    directories: BTreeSet<String>,
    #[serde(default)]
    files: BTreeMap<String, CatalogEntry>,
}

impl Default for AttachmentCatalog {
    fn default() -> Self {
        Self {
            directory: default_attachment_directory(),
            directories: BTreeSet::from([default_attachment_directory()]),
            files: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug)]
struct NoteRewrite {
    before: NoteDocument,
    content: String,
}

#[derive(Clone, Debug)]
struct SavedRewrite {
    before: NoteDocument,
    saved: NoteDocument,
}

pub struct AttachmentStore {
    vault: VaultEngine,
}

impl AttachmentStore {
    pub fn open(vault: VaultEngine) -> Result<Self, AttachmentError> {
        let store = Self { vault };
        let catalog = store.load_catalog()?;
        store.ensure_safe_directory(Path::new(&catalog.directory))?;
        Ok(store)
    }

    pub fn root(&self) -> &Path {
        self.vault.root()
    }

    pub fn settings(&self) -> Result<AttachmentSettings, AttachmentError> {
        let catalog = self.load_catalog()?;
        Ok(AttachmentSettings {
            directory: catalog.directory,
        })
    }

    pub fn configure(&mut self, directory: &str) -> Result<AttachmentSettings, AttachmentError> {
        let _guard = operation_guard()?;
        let normalized = validate_attachment_directory(directory)?;
        self.ensure_safe_directory(&normalized)?;
        let mut catalog = self.load_catalog()?;
        catalog.directories.insert(catalog.directory.clone());
        catalog.directory = portable_path(&normalized);
        catalog.directories.insert(catalog.directory.clone());
        self.save_catalog(&catalog)?;
        Ok(AttachmentSettings {
            directory: catalog.directory,
        })
    }

    pub fn import_bytes(
        &self,
        note_path: &str,
        file_name: &str,
        media_type: &str,
        bytes: &[u8],
    ) -> Result<AttachmentImport, AttachmentError> {
        let _guard = operation_guard()?;
        validate_relative_note_path(note_path)?;
        self.vault.read_note(note_path)?;
        let mut catalog = self.load_catalog()?;
        let directory = validate_attachment_directory(&catalog.directory)?;
        self.ensure_safe_directory(&directory)?;
        let display_name = sanitize_file_name(file_name)?;
        let (target, relative) = self.allocate_destination(&directory, &display_name)?;
        let temporary = temporary_sibling(&target)?;
        let result = (|| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            fs::rename(&temporary, &target)?;
            let hash = blake3::hash(bytes).to_hex().to_string();
            let portable = portable_path(&relative);
            catalog.files.insert(
                portable.clone(),
                CatalogEntry {
                    hash: hash.clone(),
                    byte_length: bytes.len() as u64,
                },
            );
            if let Err(error) = self.save_catalog(&catalog) {
                let _ = fs::remove_file(&target);
                return Err(error);
            }
            Ok(self.import_result(note_path, &relative, media_type, true, Some(hash)))
        })();
        if temporary.exists() {
            let _ = fs::remove_file(temporary);
        }
        result
    }

    pub fn import_path(
        &self,
        note_path: &str,
        source_path: impl AsRef<Path>,
    ) -> Result<AttachmentImport, AttachmentError> {
        let _guard = operation_guard()?;
        validate_relative_note_path(note_path)?;
        self.vault.read_note(note_path)?;
        let source = source_path
            .as_ref()
            .canonicalize()
            .map_err(|_| AttachmentError::SourceUnavailable)?;
        if !source.is_file() {
            return Err(AttachmentError::SourceUnavailable);
        }
        let internal_root = self.vault.root().join(INTERNAL_DIR);
        if source.starts_with(&internal_root) {
            return Err(AttachmentError::OutsideAttachmentDirectory);
        }
        let mut catalog = self.load_catalog()?;
        let directory = validate_attachment_directory(&catalog.directory)?;
        self.ensure_safe_directory(&directory)?;

        let existing_relative = source
            .strip_prefix(self.vault.root())
            .ok()
            .and_then(|relative| {
                self.validate_attachment_path(&portable_path(relative), &catalog)
                    .ok()
            });
        if let Some(relative) = existing_relative {
            let (hash, byte_length) = hash_file(&source)?;
            let portable = portable_path(&relative);
            catalog
                .files
                .insert(portable, CatalogEntry { hash, byte_length });
            self.save_catalog(&catalog)?;
            return Ok(self.import_result(
                note_path,
                &relative,
                media_type_for(&source),
                false,
                None,
            ));
        }

        let original_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(AttachmentError::InvalidFileName)?;
        let display_name = sanitize_file_name(original_name)?;
        let (target, relative) = self.allocate_destination(&directory, &display_name)?;
        let temporary = temporary_sibling(&target)?;
        let result = (|| {
            let mut input = File::open(&source)?;
            let mut output = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)?;
            let (hash, byte_length) = copy_and_hash(&mut input, &mut output)?;
            output.sync_all()?;
            drop(output);
            fs::rename(&temporary, &target)?;
            let portable = portable_path(&relative);
            catalog.files.insert(
                portable,
                CatalogEntry {
                    hash: hash.clone(),
                    byte_length,
                },
            );
            if let Err(error) = self.save_catalog(&catalog) {
                let _ = fs::remove_file(&target);
                return Err(error);
            }
            Ok(self.import_result(
                note_path,
                &relative,
                media_type_for(&source),
                true,
                Some(hash),
            ))
        })();
        if temporary.exists() {
            let _ = fs::remove_file(temporary);
        }
        result
    }

    pub fn rollback_import(
        &self,
        relative_path: &str,
        rollback_token: &str,
    ) -> Result<bool, AttachmentError> {
        let _guard = operation_guard()?;
        let mut catalog = self.load_catalog()?;
        let normalized = self.validate_attachment_path(relative_path, &catalog)?;
        let target = self.resolve_existing_attachment(&normalized, &catalog)?;
        let (actual_hash, _) = hash_file(&target)?;
        if actual_hash != rollback_token {
            return Ok(false);
        }
        fs::remove_file(target)?;
        catalog.files.remove(&portable_path(&normalized));
        self.save_catalog(&catalog)?;
        Ok(true)
    }

    pub fn move_and_repair(
        &self,
        from: &str,
        to: &str,
    ) -> Result<AttachmentMoveResult, AttachmentError> {
        let _guard = operation_guard()?;
        let original_catalog = self.load_catalog()?;
        let source_relative = self.validate_attachment_path(from, &original_catalog)?;
        let source = self.resolve_existing_attachment(&source_relative, &original_catalog)?;
        let requested_destination = self.validate_attachment_path(to, &original_catalog)?;
        let file_name = requested_destination
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or(AttachmentError::InvalidFileName)?;
        let sanitized = sanitize_file_name(file_name)?;
        let destination_relative = requested_destination
            .parent()
            .unwrap_or_else(|| Path::new(""))
            .join(sanitized);
        let destination_parent = destination_relative
            .parent()
            .ok_or(AttachmentError::OutsideAttachmentDirectory)?;
        self.ensure_safe_directory(destination_parent)?;
        let destination = self.vault.root().join(&destination_relative);
        if destination.exists() {
            return Err(AttachmentError::Io(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "destination attachment already exists",
            )));
        }

        let rewrites = self.plan_rewrites(&source_relative, &destination_relative)?;
        let saved = self.apply_rewrites(&rewrites)?;
        if let Err(error) = fs::rename(&source, &destination) {
            self.rollback_rewrites(&saved)?;
            return Err(error.into());
        }

        let mut next_catalog = original_catalog.clone();
        let source_key = portable_path(&source_relative);
        let destination_key = portable_path(&destination_relative);
        let entry = next_catalog.files.remove(&source_key).map_or_else(
            || {
                hash_file(&destination)
                    .map(|(hash, byte_length)| CatalogEntry { hash, byte_length })
            },
            Ok,
        )?;
        next_catalog.files.insert(destination_key.clone(), entry);
        if let Err(error) = self.save_catalog(&next_catalog) {
            let renamed_back = fs::rename(&destination, &source).is_ok();
            let notes_rolled_back = self.rollback_rewrites(&saved).is_ok();
            if !renamed_back || !notes_rolled_back {
                return Err(AttachmentError::RollbackFailed);
            }
            return Err(error);
        }

        Ok(AttachmentMoveResult {
            relative_path: destination_key,
            updated_notes: saved.into_iter().map(|rewrite| rewrite.saved).collect(),
        })
    }

    pub fn scan_issues(&self) -> Result<Vec<AttachmentIssue>, AttachmentError> {
        let _guard = operation_guard()?;
        let catalog = self.load_catalog()?;
        let current = self.current_attachment_hashes(&catalog)?;
        let mut suggestions_by_hash: HashMap<String, Vec<String>> = HashMap::new();
        for (path, entry) in &current {
            suggestions_by_hash
                .entry(entry.hash.clone())
                .or_default()
                .push(path.clone());
        }

        let mut issues = Vec::new();
        for note in self.vault.list_notes()? {
            let document = self.vault.read_note(&note.relative_path)?;
            for target in markdown_targets(&document.content) {
                let Some(resolved) = resolve_markdown_target(&document.relative_path, &target)
                else {
                    continue;
                };
                if self
                    .validate_attachment_path(&portable_path(&resolved), &catalog)
                    .is_err()
                    || self.vault.root().join(&resolved).is_file()
                {
                    continue;
                }
                let expected = catalog.files.get(&portable_path(&resolved));
                let suggestion = expected.and_then(|entry| {
                    let matches = suggestions_by_hash.get(&entry.hash)?;
                    (matches.len() == 1).then(|| matches[0].clone())
                });
                issues.push(AttachmentIssue {
                    note_path: document.relative_path.clone(),
                    broken_target: target,
                    suggested_path: suggestion,
                });
            }
        }
        Ok(issues)
    }

    pub fn repair_issue(&self, issue: &AttachmentIssue) -> Result<NoteDocument, AttachmentError> {
        let _guard = operation_guard()?;
        let suggested = issue
            .suggested_path
            .as_deref()
            .ok_or(AttachmentError::RepairConflict)?;
        let mut catalog = self.load_catalog()?;
        let destination_relative = self.validate_attachment_path(suggested, &catalog)?;
        let destination = self.resolve_existing_attachment(&destination_relative, &catalog)?;
        let broken_relative = resolve_markdown_target(&issue.note_path, &issue.broken_target)
            .ok_or(AttachmentError::RepairConflict)?;
        let expected = catalog
            .files
            .get(&portable_path(&broken_relative))
            .ok_or(AttachmentError::RepairConflict)?
            .clone();
        let (actual_hash, _) = hash_file(&destination)?;
        if actual_hash != expected.hash {
            return Err(AttachmentError::RepairConflict);
        }
        let before = self.vault.read_note(&issue.note_path)?;
        let content = replace_exact_target(
            &before.content,
            &issue.broken_target,
            &relative_markdown_path(&issue.note_path, &destination_relative),
        );
        if content == before.content {
            return Err(AttachmentError::RepairConflict);
        }
        let saved = match self
            .vault
            .save_note(&issue.note_path, &content, &before.revision)?
        {
            SaveOutcome::Saved { document, .. } => document,
            SaveOutcome::Conflict { .. } => return Err(AttachmentError::RepairConflict),
        };
        catalog.files.remove(&portable_path(&broken_relative));
        catalog
            .files
            .insert(portable_path(&destination_relative), expected);
        if let Err(error) = self.save_catalog(&catalog) {
            let rollback =
                self.vault
                    .save_note(&before.relative_path, &before.content, &saved.revision)?;
            if !matches!(rollback, SaveOutcome::Saved { .. }) {
                return Err(AttachmentError::RollbackFailed);
            }
            return Err(error);
        }
        Ok(saved)
    }

    pub fn inventory(&self) -> Result<Vec<AttachmentInventoryEntry>, AttachmentError> {
        let catalog = self.load_catalog()?;
        let referenced = self.referenced_attachments(&catalog)?;
        let mut inventory = self
            .current_attachment_hashes(&catalog)?
            .into_iter()
            .map(|(relative_path, entry)| AttachmentInventoryEntry {
                referenced: referenced.contains(&relative_path),
                relative_path,
                byte_length: entry.byte_length,
            })
            .collect::<Vec<_>>();
        inventory.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        Ok(inventory)
    }

    pub fn preview_path(&self, relative_path: &str) -> Result<String, AttachmentError> {
        let catalog = self.load_catalog()?;
        let normalized = self.validate_attachment_path(relative_path, &catalog)?;
        if !is_image_path(&normalized) {
            return Err(AttachmentError::InvalidFileName);
        }
        Ok(self
            .resolve_existing_attachment(&normalized, &catalog)?
            .to_string_lossy()
            .into_owned())
    }

    fn import_result(
        &self,
        note_path: &str,
        relative: &Path,
        media_type: &str,
        created: bool,
        rollback_token: Option<String>,
    ) -> AttachmentImport {
        let display_name = relative
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("attachment")
            .to_owned();
        let target = relative_markdown_path(note_path, relative);
        let markdown = if media_type.starts_with("image/") || is_image_path(relative) {
            format!("![{display_name}]({target})")
        } else {
            format!("[{display_name}]({target})")
        };
        AttachmentImport {
            relative_path: portable_path(relative),
            markdown,
            display_name,
            created,
            rollback_token,
        }
    }

    fn allocate_destination(
        &self,
        directory: &Path,
        file_name: &str,
    ) -> Result<(PathBuf, PathBuf), AttachmentError> {
        let path = Path::new(file_name);
        let stem = path
            .file_stem()
            .and_then(|value| value.to_str())
            .ok_or(AttachmentError::InvalidFileName)?;
        let extension = path.extension().and_then(|value| value.to_str());
        for attempt in 1..=10_000_u32 {
            let candidate_name = if attempt == 1 {
                file_name.to_owned()
            } else if let Some(extension) = extension {
                format!("{stem}-{attempt}.{extension}")
            } else {
                format!("{stem}-{attempt}")
            };
            let relative = directory.join(candidate_name);
            let target = self.vault.root().join(&relative);
            if !target.exists() {
                return Ok((target, relative));
            }
        }
        Err(AttachmentError::Io(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "unable to create a collision-free attachment name",
        )))
    }

    fn validate_attachment_path(
        &self,
        relative_path: &str,
        catalog: &AttachmentCatalog,
    ) -> Result<PathBuf, AttachmentError> {
        let normalized = validate_relative_entry_path(relative_path)?;
        let allowed = self
            .known_directories(catalog)?
            .into_iter()
            .any(|directory| normalized.starts_with(&directory) && normalized != directory);
        if !allowed {
            return Err(AttachmentError::OutsideAttachmentDirectory);
        }
        Ok(normalized)
    }

    fn resolve_existing_attachment(
        &self,
        normalized: &Path,
        catalog: &AttachmentCatalog,
    ) -> Result<PathBuf, AttachmentError> {
        self.validate_attachment_path(&portable_path(normalized), catalog)?;
        let canonical = self
            .vault
            .root()
            .join(normalized)
            .canonicalize()
            .map_err(|_| AttachmentError::SourceUnavailable)?;
        if !canonical.starts_with(self.vault.root()) || !canonical.is_file() {
            return Err(AttachmentError::OutsideAttachmentDirectory);
        }
        Ok(canonical)
    }

    fn ensure_safe_directory(&self, relative: &Path) -> Result<PathBuf, AttachmentError> {
        let normalized = validate_attachment_directory(&portable_path(relative))?;
        let mut current = self.vault.root().to_path_buf();
        for component in normalized.components() {
            let Component::Normal(value) = component else {
                return Err(AttachmentError::OutsideAttachmentDirectory);
            };
            current.push(value);
            if current.exists() {
                let canonical = current.canonicalize()?;
                if !canonical.starts_with(self.vault.root()) || !canonical.is_dir() {
                    return Err(AttachmentError::OutsideAttachmentDirectory);
                }
                current = canonical;
            } else {
                fs::create_dir(&current)?;
            }
        }
        Ok(current)
    }

    fn plan_rewrites(&self, from: &Path, to: &Path) -> Result<Vec<NoteRewrite>, AttachmentError> {
        let mut rewrites = Vec::new();
        for note in self.vault.list_notes()? {
            let before = self.vault.read_note(&note.relative_path)?;
            let content = rewrite_resolved_target(&before, from, to);
            if content != before.content {
                rewrites.push(NoteRewrite { before, content });
            }
        }
        Ok(rewrites)
    }

    fn apply_rewrites(
        &self,
        rewrites: &[NoteRewrite],
    ) -> Result<Vec<SavedRewrite>, AttachmentError> {
        let mut saved = Vec::new();
        for rewrite in rewrites {
            match self.vault.save_note(
                &rewrite.before.relative_path,
                &rewrite.content,
                &rewrite.before.revision,
            ) {
                Ok(SaveOutcome::Saved { document, .. }) => saved.push(SavedRewrite {
                    before: rewrite.before.clone(),
                    saved: document,
                }),
                Ok(SaveOutcome::Conflict { .. }) => {
                    self.rollback_rewrites(&saved)?;
                    return Err(AttachmentError::RepairConflict);
                }
                Err(error) => {
                    self.rollback_rewrites(&saved)?;
                    return Err(error.into());
                }
            }
        }
        Ok(saved)
    }

    fn rollback_rewrites(&self, rewrites: &[SavedRewrite]) -> Result<(), AttachmentError> {
        for rewrite in rewrites.iter().rev() {
            let outcome = self.vault.save_note(
                &rewrite.before.relative_path,
                &rewrite.before.content,
                &rewrite.saved.revision,
            )?;
            if !matches!(outcome, SaveOutcome::Saved { .. }) {
                return Err(AttachmentError::RollbackFailed);
            }
        }
        Ok(())
    }

    fn current_attachment_hashes(
        &self,
        catalog: &AttachmentCatalog,
    ) -> Result<BTreeMap<String, CatalogEntry>, AttachmentError> {
        let mut entries = BTreeMap::new();
        for directory in self.known_directories(catalog)? {
            let root = self.ensure_safe_directory(&directory)?;
            for entry in WalkDir::new(root).follow_links(false) {
                let entry = entry.map_err(|error| {
                    AttachmentError::Io(error.into_io_error().unwrap_or_else(|| {
                        std::io::Error::other("unable to enumerate attachments")
                    }))
                })?;
                if !entry.file_type().is_file() {
                    continue;
                }
                let relative = entry
                    .path()
                    .strip_prefix(self.vault.root())
                    .map_err(|_| AttachmentError::OutsideAttachmentDirectory)?;
                let (hash, byte_length) = hash_file(entry.path())?;
                entries.insert(portable_path(relative), CatalogEntry { hash, byte_length });
            }
        }
        Ok(entries)
    }

    fn referenced_attachments(
        &self,
        catalog: &AttachmentCatalog,
    ) -> Result<BTreeSet<String>, AttachmentError> {
        let mut referenced = BTreeSet::new();
        for note in self.vault.list_notes()? {
            let document = self.vault.read_note(&note.relative_path)?;
            for target in markdown_targets(&document.content) {
                if let Some(resolved) = resolve_markdown_target(&document.relative_path, &target) {
                    if self
                        .validate_attachment_path(&portable_path(&resolved), catalog)
                        .is_ok()
                    {
                        referenced.insert(portable_path(&resolved));
                    }
                }
            }
        }
        Ok(referenced)
    }

    fn known_directories(
        &self,
        catalog: &AttachmentCatalog,
    ) -> Result<Vec<PathBuf>, AttachmentError> {
        let mut directories = catalog.directories.clone();
        directories.insert(catalog.directory.clone());
        directories
            .into_iter()
            .map(|directory| validate_attachment_directory(&directory))
            .collect()
    }

    fn catalog_path(&self) -> PathBuf {
        self.vault
            .root()
            .join(INTERNAL_DIR)
            .join("attachments.json")
    }

    fn load_catalog(&self) -> Result<AttachmentCatalog, AttachmentError> {
        let path = self.catalog_path();
        if !path.exists() {
            return Ok(AttachmentCatalog::default());
        }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    fn save_catalog(&self, catalog: &AttachmentCatalog) -> Result<(), AttachmentError> {
        let path = self.catalog_path();
        fs::create_dir_all(
            path.parent()
                .ok_or(AttachmentError::OutsideAttachmentDirectory)?,
        )?;
        let temporary = temporary_sibling(&path)?;
        let result = (|| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)?;
            file.write_all(&serde_json::to_vec_pretty(catalog)?)?;
            file.sync_all()?;
            drop(file);
            atomic_replace(&temporary, &path)?;
            Ok(())
        })();
        if temporary.exists() {
            let _ = fs::remove_file(temporary);
        }
        result
    }
}

fn operation_guard() -> Result<MutexGuard<'static, ()>, AttachmentError> {
    ATTACHMENT_OPERATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| {
            AttachmentError::Io(std::io::Error::other("attachment operations unavailable"))
        })
}

fn default_attachment_directory() -> String {
    DEFAULT_ATTACHMENT_DIRECTORY.to_owned()
}

fn validate_attachment_directory(path: &str) -> Result<PathBuf, AttachmentError> {
    let normalized = validate_relative_entry_path(path)?;
    if normalized
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
    {
        return Err(AttachmentError::OutsideAttachmentDirectory);
    }
    Ok(normalized)
}

fn sanitize_file_name(file_name: &str) -> Result<String, AttachmentError> {
    let path = Path::new(file_name);
    let stem = path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment");
    let extension = path.extension().and_then(|value| value.to_str());
    let mut safe_stem = sanitize_name_part(stem);
    if safe_stem.is_empty() {
        safe_stem = "attachment".to_owned();
    }
    if is_reserved_windows_name(&safe_stem) {
        safe_stem.insert(0, '_');
    }
    let safe_extension = extension
        .map(sanitize_name_part)
        .filter(|value| !value.is_empty());
    let name = safe_extension.map_or(safe_stem.clone(), |extension| {
        format!("{safe_stem}.{extension}")
    });
    if name == "." || name == ".." {
        return Err(AttachmentError::InvalidFileName);
    }
    Ok(name)
}

fn sanitize_name_part(value: &str) -> String {
    value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect::<String>()
        .trim_end_matches([' ', '.'])
        .to_owned()
}

fn is_reserved_windows_name(stem: &str) -> bool {
    let upper = stem.to_ascii_uppercase();
    matches!(upper.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || upper
            .strip_prefix("COM")
            .or_else(|| upper.strip_prefix("LPT"))
            .is_some_and(|number| {
                matches!(number, "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9")
            })
}

fn copy_and_hash(
    input: &mut impl Read,
    output: &mut impl Write,
) -> Result<(String, u64), AttachmentError> {
    let mut hasher = blake3::Hasher::new();
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    let mut byte_length = 0_u64;
    loop {
        let read = input.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        output.write_all(&buffer[..read])?;
        hasher.update(&buffer[..read]);
        byte_length += read as u64;
    }
    Ok((hasher.finalize().to_hex().to_string(), byte_length))
}

fn hash_file(path: &Path) -> Result<(String, u64), AttachmentError> {
    let mut file = File::open(path)?;
    let mut sink = std::io::sink();
    copy_and_hash(&mut file, &mut sink)
}

fn media_type_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        _ => "application/octet-stream",
    }
}

fn is_image_path(path: &Path) -> bool {
    media_type_for(path).starts_with("image/")
}

fn relative_markdown_path(note_path: &str, target: &Path) -> String {
    let note = validate_relative_note_path(note_path).unwrap_or_else(|_| PathBuf::from(note_path));
    let note_parent = note.parent().unwrap_or_else(|| Path::new(""));
    let from = normal_components(note_parent);
    let to = normal_components(target);
    let common = from
        .iter()
        .zip(&to)
        .take_while(|(left, right)| left == right)
        .count();
    let mut pieces = vec!["..".to_owned(); from.len().saturating_sub(common)];
    pieces.extend(
        to[common..]
            .iter()
            .map(|part| part.to_string_lossy().into_owned()),
    );
    pieces
        .into_iter()
        .map(|piece| utf8_percent_encode(&piece, MARKDOWN_URL_ENCODE).to_string())
        .collect::<Vec<_>>()
        .join("/")
}

fn normal_components(path: &Path) -> Vec<&std::ffi::OsStr> {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value),
            _ => None,
        })
        .collect()
}

fn markdown_link_regex() -> &'static Regex {
    MARKDOWN_LINK.get_or_init(|| {
        Regex::new(
            r#"!?\[[^\]\r\n]*\]\((?P<target><[^>\r\n]+>|[^)\s\r\n]+)(?:\s+[\"'][^\"']*[\"'])?\)"#,
        )
        .expect("valid Markdown link expression")
    })
}

fn markdown_targets(content: &str) -> Vec<String> {
    markdown_link_regex()
        .captures_iter(content)
        .filter_map(|captures| captures.name("target"))
        .map(|target| target.as_str().trim_matches(['<', '>']).to_owned())
        .collect()
}

fn resolve_markdown_target(note_path: &str, target: &str) -> Option<PathBuf> {
    if target.starts_with('#') || target.contains("://") || target.starts_with("data:") {
        return None;
    }
    let decoded = percent_decode_str(target.trim_matches(['<', '>']))
        .decode_utf8()
        .ok()?
        .replace('\\', "/");
    let candidate = Path::new(note_path)
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .join(decoded);
    normalize_lexical(&candidate)
}

fn normalize_lexical(path: &Path) -> Option<PathBuf> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(value) => normalized.push(value),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return None;
                }
            }
            Component::RootDir | Component::Prefix(_) => return None,
        }
    }
    Some(normalized)
}

fn rewrite_resolved_target(document: &NoteDocument, from: &Path, to: &Path) -> String {
    let replacement = relative_markdown_path(&document.relative_path, to);
    markdown_link_regex()
        .replace_all(&document.content, |captures: &Captures<'_>| {
            let Some(target) = captures.name("target") else {
                return captures[0].to_owned();
            };
            let raw = target.as_str().trim_matches(['<', '>']);
            if resolve_markdown_target(&document.relative_path, raw).as_deref() != Some(from) {
                return captures[0].to_owned();
            }
            let mut matched = captures[0].to_owned();
            let local_start = target.start() - captures.get(0).map_or(0, |whole| whole.start());
            let local_end = local_start + target.as_str().len();
            matched.replace_range(local_start..local_end, &replacement);
            matched
        })
        .into_owned()
}

fn replace_exact_target(content: &str, from: &str, to: &str) -> String {
    markdown_link_regex()
        .replace_all(content, |captures: &Captures<'_>| {
            let Some(target) = captures.name("target") else {
                return captures[0].to_owned();
            };
            if target.as_str().trim_matches(['<', '>']) != from {
                return captures[0].to_owned();
            }
            let mut matched = captures[0].to_owned();
            let local_start = target.start() - captures.get(0).map_or(0, |whole| whole.start());
            let local_end = local_start + target.as_str().len();
            matched.replace_range(local_start..local_end, to);
            matched
        })
        .into_owned()
}
