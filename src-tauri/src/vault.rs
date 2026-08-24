use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use walkdir::WalkDir;

pub const INTERNAL_DIR: &str = ".serein";
pub const HUSHNOTE_INTERNAL_DIR: &str = ".hushnote";
pub const LEGACY_INTERNAL_DIR: &str = ".writ";
pub const SYNTHETIC_VAULT_MARKER: &str = ".serein-synthetic-vault";
pub const HUSHNOTE_SYNTHETIC_VAULT_MARKER: &str = ".hushnote-synthetic-vault";
pub const LEGACY_SYNTHETIC_VAULT_MARKER: &str = ".writ-synthetic-vault";
const SYNTHETIC_VAULT_MARKER_CONTENT: &str = "serein synthetic vault v1";
const HUSHNOTE_SYNTHETIC_VAULT_MARKER_CONTENT: &str = "hushnote synthetic vault v1";
const LEGACY_SYNTHETIC_VAULT_MARKER_CONTENT: &str = "writ-io synthetic vault v1";
static TEMP_FILE_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Error)]
pub enum VaultError {
    #[error("vault path does not exist or is unavailable")]
    VaultUnavailable,
    #[error("only generated Serein synthetic vaults are allowed at this checkpoint")]
    SyntheticVaultRequired,
    #[error("multiple Serein or legacy metadata directories exist; migration stopped to protect every version")]
    InternalMetadataConflict,
    #[error("note path must stay inside the vault")]
    InvalidRelativePath,
    #[error("only Markdown files can be opened as notes")]
    MarkdownRequired,
    #[error("note was not found")]
    NoteNotFound,
    #[error("note is not valid UTF-8 Markdown")]
    InvalidUtf8,
    #[error("recovery operation failed: {0}")]
    Recovery(String),
    #[error("filesystem operation failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Debug)]
pub struct VaultEngine {
    root: PathBuf,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteEntry {
    pub relative_path: String,
    pub file_name: String,
    pub byte_length: u64,
    pub modified_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub relative_path: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NoteDocument {
    pub relative_path: String,
    pub content: String,
    pub revision: String,
    pub modified_ms: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultSnapshot {
    pub root: String,
    pub notes: Vec<NoteEntry>,
    pub folders: Vec<FolderEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashRecord {
    pub id: String,
    pub original_path: String,
    pub trashed_path: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreservedSaveOutcome {
    pub outcome: SaveOutcome,
    pub backup_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SaveOutcome {
    Saved {
        document: NoteDocument,
        previous_revision: String,
    },
    Conflict {
        expected_revision: String,
        disk: NoteDocument,
    },
}

impl VaultEngine {
    pub fn open(path: impl AsRef<Path>) -> Result<Self, VaultError> {
        let root = path
            .as_ref()
            .canonicalize()
            .map_err(|_| VaultError::VaultUnavailable)?;

        let current_marker = root.join(SYNTHETIC_VAULT_MARKER);
        let hushnote_marker = root.join(HUSHNOTE_SYNTHETIC_VAULT_MARKER);
        let writ_marker = root.join(LEGACY_SYNTHETIC_VAULT_MARKER);
        let (marker_path, marker) = [current_marker, hushnote_marker, writ_marker]
            .into_iter()
            .find_map(|path| {
                fs::read_to_string(&path)
                    .ok()
                    .map(|content| (path, content))
            })
            .ok_or(VaultError::SyntheticVaultRequired)?;
        if marker.trim() != SYNTHETIC_VAULT_MARKER_CONTENT
            && marker.trim() != HUSHNOTE_SYNTHETIC_VAULT_MARKER_CONTENT
            && marker.trim() != LEGACY_SYNTHETIC_VAULT_MARKER_CONTENT
        {
            return Err(VaultError::SyntheticVaultRequired);
        }

        migrate_internal_directory(&root)?;
        migrate_synthetic_marker(&root, &marker_path)?;

        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn snapshot(&self) -> Result<VaultSnapshot, VaultError> {
        Ok(VaultSnapshot {
            root: self.root.to_string_lossy().into_owned(),
            notes: self.list_notes()?,
            folders: self.list_folders()?,
        })
    }

    pub fn list_folders(&self) -> Result<Vec<FolderEntry>, VaultError> {
        let mut folders = Vec::new();
        for entry in WalkDir::new(&self.root)
            .min_depth(1)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| !is_internal_entry_name(entry.file_name()))
        {
            let entry = entry.map_err(|error| {
                VaultError::Io(error.into_io_error().unwrap_or_else(|| {
                    std::io::Error::other("unable to enumerate synthetic vault folders")
                }))
            })?;
            if !entry.file_type().is_dir() {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(&self.root)
                .map_err(|_| VaultError::InvalidRelativePath)?;
            folders.push(FolderEntry {
                relative_path: portable_path(relative),
                name: entry.file_name().to_string_lossy().into_owned(),
            });
        }
        folders.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        Ok(folders)
    }

    pub fn list_notes(&self) -> Result<Vec<NoteEntry>, VaultError> {
        let mut notes = Vec::new();

        for entry in WalkDir::new(&self.root)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| !is_internal_entry_name(entry.file_name()))
        {
            let entry = entry.map_err(|error| {
                VaultError::Io(error.into_io_error().unwrap_or_else(|| {
                    std::io::Error::other("unable to enumerate synthetic vault")
                }))
            })?;
            if !entry.file_type().is_file() || !is_markdown(entry.path()) {
                continue;
            }

            let relative = entry
                .path()
                .strip_prefix(&self.root)
                .map_err(|_| VaultError::InvalidRelativePath)?;
            let metadata = entry.metadata().map_err(|error| {
                VaultError::Io(std::io::Error::new(
                    error
                        .io_error()
                        .map_or(std::io::ErrorKind::Other, std::io::Error::kind),
                    "unable to inspect note",
                ))
            })?;
            notes.push(NoteEntry {
                relative_path: portable_path(relative),
                file_name: entry.file_name().to_string_lossy().into_owned(),
                byte_length: metadata.len(),
                modified_ms: modified_ms(&metadata),
            });
        }

        notes.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        Ok(notes)
    }

    pub fn read_note(&self, relative_path: &str) -> Result<NoteDocument, VaultError> {
        let (path, normalized) = self.resolve_existing_note(relative_path)?;
        let bytes = fs::read(&path)?;
        let content = String::from_utf8(bytes).map_err(|_| VaultError::InvalidUtf8)?;
        let metadata = fs::metadata(path)?;

        Ok(NoteDocument {
            relative_path: portable_path(&normalized),
            revision: revision_for(content.as_bytes()),
            content,
            modified_ms: modified_ms(&metadata),
        })
    }

    pub fn save_note(
        &self,
        relative_path: &str,
        content: &str,
        expected_revision: &str,
    ) -> Result<SaveOutcome, VaultError> {
        let before = self.read_note(relative_path)?;
        if before.revision != expected_revision {
            return Ok(SaveOutcome::Conflict {
                expected_revision: expected_revision.to_owned(),
                disk: before,
            });
        }

        let (target, _) = self.resolve_existing_note(relative_path)?;
        let temporary = temporary_sibling(&target)?;
        let save_result = (|| {
            let mut file = OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temporary)?;
            file.write_all(content.as_bytes())?;
            file.sync_all()?;
            drop(file);

            let immediately_before_replace = self.read_note(relative_path)?;
            if immediately_before_replace.revision != expected_revision {
                return Ok(SaveOutcome::Conflict {
                    expected_revision: expected_revision.to_owned(),
                    disk: immediately_before_replace,
                });
            }

            atomic_replace(&temporary, &target)?;
            let document = self.read_note(relative_path)?;
            Ok(SaveOutcome::Saved {
                document,
                previous_revision: before.revision,
            })
        })();

        if temporary.exists() {
            let _ = fs::remove_file(&temporary);
        }
        save_result
    }

    pub fn create_note(
        &self,
        relative_path: &str,
        content: &str,
    ) -> Result<NoteDocument, VaultError> {
        let normalized = validate_relative_note_path(relative_path)?;
        let target = self.resolve_new_path(&normalized)?;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&target)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        drop(file);
        self.read_note(relative_path)
    }

    pub fn create_folder(&self, relative_path: &str) -> Result<FolderEntry, VaultError> {
        let normalized = validate_relative_entry_path(relative_path)?;
        let target = self.resolve_new_path(&normalized)?;
        fs::create_dir(&target)?;
        Ok(FolderEntry {
            relative_path: portable_path(&normalized),
            name: target
                .file_name()
                .ok_or(VaultError::InvalidRelativePath)?
                .to_string_lossy()
                .into_owned(),
        })
    }

    pub fn move_entry(&self, from: &str, to: &str) -> Result<(), VaultError> {
        let (source, source_relative) = self.resolve_existing_entry(from)?;
        let destination_relative = validate_relative_entry_path(to)?;
        if source.is_file() && (is_markdown(&source_relative) != is_markdown(&destination_relative))
        {
            return Err(VaultError::MarkdownRequired);
        }
        let destination = self.resolve_new_path(&destination_relative)?;
        fs::rename(source, destination)?;
        Ok(())
    }

    pub fn trash_entry(&self, relative_path: &str) -> Result<TrashRecord, VaultError> {
        let (source, normalized) = self.resolve_existing_entry(relative_path)?;
        let serial = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_millis());
        let id = format!("{millis}-{serial}");
        let trash_relative = PathBuf::from(INTERNAL_DIR)
            .join("trash")
            .join(&id)
            .join(&normalized);
        let destination = self.root.join(&trash_relative);
        let parent = destination
            .parent()
            .ok_or(VaultError::InvalidRelativePath)?;
        fs::create_dir_all(parent)?;
        let kind = if source.is_dir() { "folder" } else { "note" }.to_owned();
        fs::rename(source, &destination)?;
        Ok(TrashRecord {
            id,
            original_path: portable_path(&normalized),
            trashed_path: portable_path(&trash_relative),
            kind,
        })
    }

    pub fn restore_trashed(&self, record: &TrashRecord) -> Result<(), VaultError> {
        let id = validate_trash_id(&record.id)?;
        let original = validate_relative_entry_path(&record.original_path)?;
        let expected_trashed = PathBuf::from(INTERNAL_DIR)
            .join("trash")
            .join(id)
            .join(&original);
        if portable_path(&expected_trashed) != record.trashed_path {
            return Err(VaultError::InvalidRelativePath);
        }
        let source = self.root.join(&expected_trashed);
        let source_canonical = source
            .canonicalize()
            .map_err(|_| VaultError::NoteNotFound)?;
        let trash_root = self
            .root
            .join(INTERNAL_DIR)
            .join("trash")
            .canonicalize()
            .map_err(|_| VaultError::VaultUnavailable)?;
        if !source_canonical.starts_with(&trash_root) {
            return Err(VaultError::InvalidRelativePath);
        }
        let destination = self.resolve_new_path(&original)?;
        fs::rename(source_canonical, destination)?;
        let trash_group = self.root.join(INTERNAL_DIR).join("trash").join(&record.id);
        let _ = fs::remove_dir_all(trash_group);
        Ok(())
    }

    pub fn preserve_disk_and_save(
        &self,
        relative_path: &str,
        content: &str,
        expected_disk_revision: &str,
    ) -> Result<PreservedSaveOutcome, VaultError> {
        crate::recovery::RecoveryStore::open(self.clone())
            .and_then(|store| {
                store.preserve_and_save(relative_path, content, expected_disk_revision)
            })
            .map_err(|error| VaultError::Recovery(error.to_string()))
    }

    pub fn save_conflict_copy(
        &self,
        relative_path: &str,
        content: &str,
    ) -> Result<NoteDocument, VaultError> {
        let normalized = validate_relative_note_path(relative_path)?;
        let parent = normalized.parent().unwrap_or_else(|| Path::new(""));
        let stem = normalized
            .file_stem()
            .ok_or(VaultError::InvalidRelativePath)?
            .to_string_lossy();
        for attempt in 1..=10_000_u32 {
            let suffix = if attempt == 1 {
                " (conflict)".to_owned()
            } else {
                format!(" (conflict {attempt})")
            };
            let candidate = parent.join(format!("{stem}{suffix}.md"));
            let portable = portable_path(&candidate);
            match self.create_note(&portable, content) {
                Ok(document) => return Ok(document),
                Err(VaultError::Io(error)) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                }
                Err(error) => return Err(error),
            }
        }
        Err(VaultError::Io(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "unable to create a collision-free conflict copy",
        )))
    }

    fn resolve_existing_note(&self, relative_path: &str) -> Result<(PathBuf, PathBuf), VaultError> {
        let normalized = validate_relative_note_path(relative_path)?;
        let joined = self.root.join(&normalized);
        let canonical = joined
            .canonicalize()
            .map_err(|_| VaultError::NoteNotFound)?;
        if !canonical.starts_with(&self.root) || !canonical.is_file() {
            return Err(VaultError::InvalidRelativePath);
        }
        Ok((canonical, normalized))
    }

    pub(crate) fn resolve_existing_entry(
        &self,
        relative_path: &str,
    ) -> Result<(PathBuf, PathBuf), VaultError> {
        let normalized = validate_relative_entry_path(relative_path)?;
        let joined = self.root.join(&normalized);
        let canonical = joined
            .canonicalize()
            .map_err(|_| VaultError::NoteNotFound)?;
        if !canonical.starts_with(&self.root) || canonical == self.root {
            return Err(VaultError::InvalidRelativePath);
        }
        Ok((canonical, normalized))
    }

    pub(crate) fn resolve_new_path(&self, normalized: &Path) -> Result<PathBuf, VaultError> {
        let parent = normalized.parent().unwrap_or_else(|| Path::new(""));
        let parent_canonical = self
            .root
            .join(parent)
            .canonicalize()
            .map_err(|_| VaultError::NoteNotFound)?;
        if !parent_canonical.starts_with(&self.root) || !parent_canonical.is_dir() {
            return Err(VaultError::InvalidRelativePath);
        }
        let target = self.root.join(normalized);
        if target.exists() {
            return Err(VaultError::Io(std::io::Error::new(
                std::io::ErrorKind::AlreadyExists,
                "destination already exists",
            )));
        }
        Ok(target)
    }
}

pub fn create_synthetic_vault() -> Result<VaultEngine, VaultError> {
    let base = std::env::temp_dir().join("serein-synthetic-vaults");
    fs::create_dir_all(&base)?;
    let serial = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let root = base.join(format!("vault-{}-{serial}", std::process::id()));
    fs::create_dir(&root)?;
    fs::write(
        root.join(SYNTHETIC_VAULT_MARKER),
        format!("{SYNTHETIC_VAULT_MARKER_CONTENT}\n"),
    )?;
    fs::create_dir(root.join("Notes"))?;
    fs::create_dir(root.join("Daily"))?;
    fs::create_dir(root.join("Attachments"))?;
    fs::create_dir(root.join(INTERNAL_DIR))?;
    fs::create_dir(root.join(INTERNAL_DIR).join("backups"))?;
    fs::create_dir(root.join(INTERNAL_DIR).join("trash"))?;
    fs::write(
        root.join("Notes").join("Welcome.md"),
        "# Welcome to the synthetic vault\n\n- [ ] Test an atomic save\n\nThis vault contains generated test data only.\n",
    )?;
    fs::write(
        root.join("Daily").join("2026-08-23.md"),
        "# Sunday, August 23, 2026\n\nSynthetic daily note.\n",
    )?;
    VaultEngine::open(root)
}

pub(crate) fn temporary_sibling(target: &Path) -> Result<PathBuf, VaultError> {
    let parent = target.parent().ok_or(VaultError::InvalidRelativePath)?;
    let file_name = target
        .file_name()
        .ok_or(VaultError::InvalidRelativePath)?
        .to_string_lossy();
    let serial = TEMP_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    Ok(parent.join(format!(
        ".{file_name}.serein-tmp-{}-{serial}",
        std::process::id()
    )))
}

#[cfg(windows)]
pub(crate) fn atomic_replace(source: &Path, target: &Path) -> Result<(), VaultError> {
    use std::{iter, os::windows::ffi::OsStrExt};
    use windows_sys::Win32::Storage::FileSystem::{
        MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
    };

    let source_wide = source
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let target_wide = target
        .as_os_str()
        .encode_wide()
        .chain(iter::once(0))
        .collect::<Vec<_>>();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            target_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 {
        return Err(VaultError::Io(std::io::Error::last_os_error()));
    }
    Ok(())
}

#[cfg(not(windows))]
pub(crate) fn atomic_replace(source: &Path, target: &Path) -> Result<(), VaultError> {
    fs::rename(source, target)?;
    Ok(())
}

pub(crate) fn validate_relative_note_path(path: &str) -> Result<PathBuf, VaultError> {
    let candidate = validate_relative_entry_path(path)?;
    if !is_markdown(&candidate) {
        return Err(VaultError::MarkdownRequired);
    }
    Ok(candidate)
}

pub(crate) fn validate_relative_entry_path(path: &str) -> Result<PathBuf, VaultError> {
    let candidate = PathBuf::from(path);
    if candidate.as_os_str().is_empty()
        || candidate.is_absolute()
        || candidate.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(VaultError::InvalidRelativePath);
    }
    let first = candidate.components().next();
    if first.is_some_and(|component| {
        matches!(component, Component::Normal(value) if is_internal_entry_name(value) || value == SYNTHETIC_VAULT_MARKER || value == LEGACY_SYNTHETIC_VAULT_MARKER)
    }) {
        return Err(VaultError::InvalidRelativePath);
    }
    Ok(candidate)
}

fn validate_trash_id(id: &str) -> Result<&str, VaultError> {
    if id.is_empty()
        || !id
            .chars()
            .all(|character| character.is_ascii_digit() || character == '-')
    {
        return Err(VaultError::InvalidRelativePath);
    }
    Ok(id)
}

fn is_markdown(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
}

pub(crate) fn portable_path(path: &Path) -> String {
    path.components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn revision_for(bytes: &[u8]) -> String {
    blake3::hash(bytes).to_hex().to_string()
}

pub fn revision_for_content(content: &str) -> String {
    revision_for(content.as_bytes())
}

fn modified_ms(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map_or(0, |duration| duration.as_millis() as u64)
}

fn is_internal_entry_name(value: &std::ffi::OsStr) -> bool {
    value.eq_ignore_ascii_case(INTERNAL_DIR)
        || value.eq_ignore_ascii_case(HUSHNOTE_INTERNAL_DIR)
        || value.eq_ignore_ascii_case(LEGACY_INTERNAL_DIR)
}

fn migrate_internal_directory(root: &Path) -> Result<(), VaultError> {
    let current = root.join(INTERNAL_DIR);
    let legacy_directories = [
        root.join(HUSHNOTE_INTERNAL_DIR),
        root.join(LEGACY_INTERNAL_DIR),
    ];
    let existing = legacy_directories
        .iter()
        .filter(|candidate| candidate.exists())
        .collect::<Vec<_>>();
    if existing.is_empty() {
        return Ok(());
    }
    if current.exists() || existing.len() != 1 || !existing[0].is_dir() {
        return Err(VaultError::InternalMetadataConflict);
    }
    let legacy = existing[0];
    fs::rename(legacy, &current)?;
    if !current.is_dir() || legacy.exists() {
        return Err(VaultError::InternalMetadataConflict);
    }
    Ok(())
}

fn migrate_synthetic_marker(root: &Path, marker_path: &Path) -> Result<(), VaultError> {
    let current = root.join(SYNTHETIC_VAULT_MARKER);
    let legacy_markers = [
        root.join(HUSHNOTE_SYNTHETIC_VAULT_MARKER),
        root.join(LEGACY_SYNTHETIC_VAULT_MARKER),
    ];
    if marker_path == current
        && fs::read_to_string(&current)?.trim() == SYNTHETIC_VAULT_MARKER_CONTENT
    {
        for legacy in legacy_markers {
            if legacy.exists() {
                fs::remove_file(legacy)?;
            }
        }
        return Ok(());
    }
    let temporary = root.join(".serein-synthetic-vault.tmp");
    fs::write(&temporary, format!("{SYNTHETIC_VAULT_MARKER_CONTENT}\n"))?;
    atomic_replace(&temporary, &current)?;
    if fs::read_to_string(&current)?.trim() != SYNTHETIC_VAULT_MARKER_CONTENT {
        return Err(VaultError::InternalMetadataConflict);
    }
    for legacy in legacy_markers {
        if legacy.exists() {
            fs::remove_file(legacy)?;
        }
    }
    Ok(())
}
