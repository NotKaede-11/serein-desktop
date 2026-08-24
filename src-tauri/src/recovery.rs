use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;
use walkdir::WalkDir;

use crate::vault::{
    atomic_replace, portable_path, temporary_sibling, validate_relative_entry_path,
    validate_relative_note_path, PreservedSaveOutcome, SaveOutcome, VaultEngine, VaultError,
    INTERNAL_DIR,
};

const DEFAULT_SNAPSHOT_INTERVAL_MINUTES: u64 = 15;
const DEFAULT_RETENTION_DAYS: u64 = 30;
const DEFAULT_MAX_STORAGE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
static RECOVERY_OPERATION_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static RECOVERY_ID_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Error)]
pub enum RecoveryError {
    #[error(transparent)]
    Vault(#[from] VaultError),
    #[error("recovery item was not found")]
    NotFound,
    #[error("the note changed while its previous version was being restored")]
    Conflict,
    #[error("the recovered Markdown is not valid UTF-8")]
    InvalidUtf8,
    #[error("recovery metadata is invalid: {0}")]
    Metadata(#[from] serde_json::Error),
    #[error("recovery operation failed: {0}")]
    Io(#[from] std::io::Error),
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RecoverySettings {
    pub snapshot_interval_minutes: u64,
    pub retention_days: u64,
    pub max_storage_bytes: u64,
    pub automatic_cleanup: bool,
    pub trash_retention_days: Option<u64>,
}

impl Default for RecoverySettings {
    fn default() -> Self {
        Self {
            snapshot_interval_minutes: DEFAULT_SNAPSHOT_INTERVAL_MINUTES,
            retention_days: DEFAULT_RETENTION_DAYS,
            max_storage_bytes: DEFAULT_MAX_STORAGE_BYTES,
            automatic_cleanup: true,
            trash_retention_days: None,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SnapshotReason {
    Interval,
    Manual,
    BeforeConflictOverwrite,
    BeforeRestore,
    BeforeReplacement,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionSnapshot {
    pub id: String,
    pub note_path: String,
    pub created_ms: u64,
    pub source_revision: String,
    pub byte_length: u64,
    pub reason: SnapshotReason,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "status", content = "snapshot", rename_all = "camelCase")]
pub enum SnapshotCapture {
    Created(VersionSnapshot),
    SkippedUnchanged,
    SkippedInterval,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionPreview {
    pub snapshot: VersionSnapshot,
    pub content: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionComparison {
    pub snapshot: VersionSnapshot,
    pub current_content: String,
    pub snapshot_content: String,
    pub added_lines: usize,
    pub removed_lines: usize,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum VersionRestoreMode {
    ReplaceCurrent,
    Copy,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VersionRestore {
    pub document: crate::vault::NoteDocument,
    pub preserved_snapshot_id: Option<String>,
    pub restored_as_copy: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CleanupSummary {
    pub removed_versions: usize,
    pub removed_trash_items: usize,
    pub reclaimed_bytes: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub id: String,
    pub original_path: String,
    pub deleted_ms: u64,
    pub kind: String,
    pub byte_length: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TrashRestorePolicy {
    Original,
    Alternate,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TrashRestoreResult {
    pub id: String,
    pub restored_path: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct TrashMetadata {
    original_path: String,
    deleted_ms: u64,
    kind: String,
    byte_length: u64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
struct VersionMetadata {
    note_path: String,
    created_ms: u64,
    source_revision: String,
    byte_length: u64,
    reason: SnapshotReason,
}

pub struct RecoveryStore {
    vault: VaultEngine,
}

impl RecoveryStore {
    pub fn open(vault: VaultEngine) -> Result<Self, RecoveryError> {
        fs::create_dir_all(vault.root().join(INTERNAL_DIR).join("backups"))?;
        fs::create_dir_all(vault.root().join(INTERNAL_DIR).join("trash"))?;
        let store = Self { vault };
        store.reconcile_trash_transients()?;
        Ok(store)
    }

    pub fn root(&self) -> &Path {
        self.vault.root()
    }

    pub fn settings(&self) -> Result<RecoverySettings, RecoveryError> {
        let path = self.settings_path();
        if !path.exists() {
            return Ok(RecoverySettings::default());
        }
        Ok(serde_json::from_slice(&fs::read(path)?)?)
    }

    pub fn update_settings(
        &self,
        settings: RecoverySettings,
    ) -> Result<RecoverySettings, RecoveryError> {
        let _guard = recovery_guard()?;
        let path = self.settings_path();
        let temporary = temporary_sibling(&path)?;
        let result = (|| {
            write_synced(&temporary, &serde_json::to_vec_pretty(&settings)?)?;
            if path.exists() {
                atomic_replace(&temporary, &path)?;
            } else {
                fs::rename(&temporary, &path)?;
            }
            Ok(settings)
        })();
        if temporary.exists() {
            let _ = fs::remove_file(temporary);
        }
        result
    }

    pub fn cleanup(&self) -> Result<CleanupSummary, RecoveryError> {
        let _guard = recovery_guard()?;
        let settings = self.settings()?;
        let mut versions = self.scan_versions()?.into_values().collect::<Vec<_>>();
        versions.sort_by(|left, right| {
            left.created_ms
                .cmp(&right.created_ms)
                .then_with(|| left.id.cmp(&right.id))
        });
        let mut sizes = BTreeMap::new();
        let mut total_bytes = 0_u64;
        for version in &versions {
            let size = directory_size(&self.backups_root().join(&version.id))?;
            total_bytes = total_bytes.saturating_add(size);
            sizes.insert(version.id.clone(), size);
        }
        let cutoff =
            now_ms().saturating_sub(settings.retention_days.saturating_mul(24 * 60 * 60 * 1_000));
        let mut removed = BTreeMap::<String, u64>::new();
        for version in &versions {
            if version.created_ms < cutoff {
                let size = *sizes.get(&version.id).unwrap_or(&0);
                self.remove_version_group(&version.id)?;
                total_bytes = total_bytes.saturating_sub(size);
                removed.insert(version.id.clone(), size);
            }
        }
        for version in &versions {
            if total_bytes <= settings.max_storage_bytes {
                break;
            }
            if removed.contains_key(&version.id) {
                continue;
            }
            let size = *sizes.get(&version.id).unwrap_or(&0);
            self.remove_version_group(&version.id)?;
            total_bytes = total_bytes.saturating_sub(size);
            removed.insert(version.id.clone(), size);
        }
        let mut summary = CleanupSummary {
            removed_versions: removed.len(),
            removed_trash_items: 0,
            reclaimed_bytes: removed.values().copied().sum(),
        };
        if let Some(retention_days) = settings.trash_retention_days {
            let trash_cutoff =
                now_ms().saturating_sub(retention_days.saturating_mul(24 * 60 * 60 * 1_000));
            let expired = self
                .list_trash_unlocked()?
                .into_iter()
                .filter(|item| item.deleted_ms < trash_cutoff)
                .collect::<Vec<_>>();
            for item in expired {
                summary.reclaimed_bytes = summary
                    .reclaimed_bytes
                    .saturating_add(directory_size(&self.trash_root().join(&item.id))?);
                self.delete_trash_group(&item.id)?;
                summary.removed_trash_items += 1;
            }
        }
        Ok(summary)
    }

    pub fn trash_entry(&self, relative_path: &str) -> Result<TrashItem, RecoveryError> {
        let _guard = recovery_guard()?;
        let normalized = validate_relative_entry_path(relative_path)?;
        let (source, _) = self.vault.resolve_existing_entry(relative_path)?;
        let deleted_ms = now_ms();
        let id = recovery_id(deleted_ms);
        let temporary = self.trash_root().join(format!(".trash-{id}.serein-tmp"));
        let final_group = self.trash_root().join(&id);
        let payload = temporary.join("payload").join(&normalized);
        fs::create_dir_all(payload.parent().ok_or(RecoveryError::NotFound)?)?;
        let kind = if source.is_dir() { "folder" } else { "note" }.to_owned();
        let byte_length = if source.is_dir() {
            directory_size(&source)?
        } else {
            fs::metadata(&source)?.len()
        };
        let item = TrashItem {
            id: id.clone(),
            original_path: portable_path(&normalized),
            deleted_ms,
            kind,
            byte_length,
        };
        let metadata = TrashMetadata {
            original_path: item.original_path.clone(),
            deleted_ms: item.deleted_ms,
            kind: item.kind.clone(),
            byte_length: item.byte_length,
        };
        let result = (|| {
            write_synced(
                &temporary.join("metadata.json"),
                &serde_json::to_vec_pretty(&metadata)?,
            )?;
            write_synced(
                &temporary.join("original-path.txt"),
                item.original_path.as_bytes(),
            )?;
            fs::rename(&source, &payload)?;
            if let Err(error) = fs::rename(&temporary, &final_group) {
                let _ = fs::rename(&payload, &source);
                return Err(error.into());
            }
            Ok(item)
        })();
        if temporary.exists() {
            let _ = fs::remove_dir_all(temporary);
        }
        result
    }

    pub fn list_trash(&self) -> Result<Vec<TrashItem>, RecoveryError> {
        let _guard = recovery_guard()?;
        self.list_trash_unlocked()
    }

    pub fn restore_trash(
        &self,
        ids: &[String],
        policy: TrashRestorePolicy,
    ) -> Result<Vec<TrashRestoreResult>, RecoveryError> {
        let _guard = recovery_guard()?;
        let available = self
            .list_trash_unlocked()?
            .into_iter()
            .map(|item| (item.id.clone(), item))
            .collect::<BTreeMap<_, _>>();
        let mut planned = Vec::new();
        let mut reserved_destinations = BTreeSet::new();
        for id in ids {
            let item = available.get(id).ok_or(RecoveryError::NotFound)?;
            let original = validate_relative_entry_path(&item.original_path)?;
            let destination = match policy {
                TrashRestorePolicy::Original => self.vault.resolve_new_path(&original)?,
                TrashRestorePolicy::Alternate => {
                    self.allocate_restored_path(&original, &reserved_destinations)?
                }
            };
            if !reserved_destinations.insert(destination.clone()) {
                return Err(RecoveryError::Io(std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    "multiple Trash items resolve to the same restore path",
                )));
            }
            let relative = destination
                .strip_prefix(self.vault.root())
                .map_err(|_| RecoveryError::NotFound)?
                .to_path_buf();
            planned.push((item.clone(), destination, relative));
        }

        let mut restored = Vec::new();
        for (item, destination, relative) in planned {
            let final_group = self.trash_root().join(&item.id);
            let temporary = self
                .trash_root()
                .join(format!(".restore-{}.serein-tmp", item.id));
            fs::rename(&final_group, &temporary)?;
            let payload = temporary
                .join("payload")
                .join(validate_relative_entry_path(&item.original_path)?);
            let result = fs::rename(&payload, &destination);
            if let Err(error) = result {
                let _ = fs::rename(&temporary, &final_group);
                return Err(error.into());
            }
            let _ = fs::remove_dir_all(&temporary);
            restored.push(TrashRestoreResult {
                id: item.id,
                restored_path: portable_path(&relative),
            });
        }
        Ok(restored)
    }

    pub fn delete_permanently(&self, ids: &[String]) -> Result<usize, RecoveryError> {
        let _guard = recovery_guard()?;
        let available = self
            .list_trash_unlocked()?
            .into_iter()
            .map(|item| item.id)
            .collect::<std::collections::BTreeSet<_>>();
        for id in ids {
            if !available.contains(id) {
                return Err(RecoveryError::NotFound);
            }
        }
        for id in ids {
            self.delete_trash_group(id)?;
        }
        Ok(ids.len())
    }

    pub fn empty_trash(&self) -> Result<usize, RecoveryError> {
        let _guard = recovery_guard()?;
        let ids = self
            .list_trash_unlocked()?
            .into_iter()
            .map(|item| item.id)
            .collect::<Vec<_>>();
        for id in &ids {
            self.delete_trash_group(id)?;
        }
        Ok(ids.len())
    }

    pub fn capture_snapshot(
        &self,
        note_path: &str,
        reason: SnapshotReason,
        force: bool,
    ) -> Result<SnapshotCapture, RecoveryError> {
        let _guard = recovery_guard()?;
        self.capture_snapshot_unlocked(note_path, reason, force)
    }

    fn capture_snapshot_unlocked(
        &self,
        note_path: &str,
        reason: SnapshotReason,
        force: bool,
    ) -> Result<SnapshotCapture, RecoveryError> {
        let normalized = validate_relative_note_path(note_path)?;
        let document = self.vault.read_note(note_path)?;
        let versions = self.list_versions_unlocked(note_path)?;
        if !force
            && versions
                .first()
                .is_some_and(|snapshot| snapshot.source_revision == document.revision)
        {
            return Ok(SnapshotCapture::SkippedUnchanged);
        }
        let now = now_ms();
        if !force {
            let interval_ms = self
                .settings()?
                .snapshot_interval_minutes
                .saturating_mul(60_000);
            if versions
                .first()
                .is_some_and(|snapshot| now.saturating_sub(snapshot.created_ms) < interval_ms)
            {
                return Ok(SnapshotCapture::SkippedInterval);
            }
        }

        let id = recovery_id(now);
        let backups = self.backups_root();
        let temporary = backups.join(format!(".{id}.serein-tmp"));
        let final_group = backups.join(&id);
        let content_path = temporary.join("content").join(&normalized);
        fs::create_dir_all(content_path.parent().ok_or(RecoveryError::NotFound)?)?;
        let result = (|| {
            write_synced(&content_path, document.content.as_bytes())?;
            let metadata = VersionMetadata {
                note_path: portable_path(&normalized),
                created_ms: now,
                source_revision: document.revision.clone(),
                byte_length: document.content.len() as u64,
                reason: reason.clone(),
            };
            write_synced(
                &temporary.join("metadata.json"),
                &serde_json::to_vec_pretty(&metadata)?,
            )?;
            write_synced(
                &temporary.join("original-path.txt"),
                metadata.note_path.as_bytes(),
            )?;
            fs::rename(&temporary, &final_group)?;
            Ok(VersionSnapshot {
                id,
                note_path: metadata.note_path,
                created_ms: metadata.created_ms,
                source_revision: metadata.source_revision,
                byte_length: metadata.byte_length,
                reason: metadata.reason,
            })
        })();
        if temporary.exists() {
            let _ = fs::remove_dir_all(&temporary);
        }
        result.map(SnapshotCapture::Created)
    }

    pub fn save_note(
        &self,
        note_path: &str,
        content: &str,
        expected_revision: &str,
    ) -> Result<SaveOutcome, RecoveryError> {
        let _guard = recovery_guard()?;
        let disk = self.vault.read_note(note_path)?;
        if disk.revision != expected_revision {
            return Ok(SaveOutcome::Conflict {
                expected_revision: expected_revision.to_owned(),
                disk,
            });
        }
        self.capture_snapshot_unlocked(note_path, SnapshotReason::Interval, false)?;
        Ok(self
            .vault
            .save_note(note_path, content, expected_revision)?)
    }

    pub fn preserve_and_save(
        &self,
        note_path: &str,
        content: &str,
        expected_revision: &str,
    ) -> Result<PreservedSaveOutcome, RecoveryError> {
        let _guard = recovery_guard()?;
        let disk = self.vault.read_note(note_path)?;
        if disk.revision != expected_revision {
            return Ok(PreservedSaveOutcome {
                outcome: SaveOutcome::Conflict {
                    expected_revision: expected_revision.to_owned(),
                    disk,
                },
                backup_path: String::new(),
            });
        }
        let capture = self.capture_snapshot_unlocked(
            note_path,
            SnapshotReason::BeforeConflictOverwrite,
            true,
        )?;
        let SnapshotCapture::Created(snapshot) = capture else {
            return Err(RecoveryError::NotFound);
        };
        let outcome = self
            .vault
            .save_note(note_path, content, expected_revision)?;
        Ok(PreservedSaveOutcome {
            outcome,
            backup_path: portable_path(
                &PathBuf::from(INTERNAL_DIR)
                    .join("backups")
                    .join(snapshot.id)
                    .join("content")
                    .join(validate_relative_note_path(note_path)?),
            ),
        })
    }

    pub fn list_versions(&self, note_path: &str) -> Result<Vec<VersionSnapshot>, RecoveryError> {
        let _guard = recovery_guard()?;
        self.list_versions_unlocked(note_path)
    }

    pub fn preview_version(&self, id: &str) -> Result<VersionPreview, RecoveryError> {
        let _guard = recovery_guard()?;
        self.preview_version_unlocked(id)
    }

    pub fn compare_version(&self, id: &str) -> Result<VersionComparison, RecoveryError> {
        let _guard = recovery_guard()?;
        let preview = self.preview_version_unlocked(id)?;
        let current = self.vault.read_note(&preview.snapshot.note_path)?;
        let (added_lines, removed_lines) = changed_line_counts(&current.content, &preview.content);
        Ok(VersionComparison {
            snapshot: preview.snapshot,
            current_content: current.content,
            snapshot_content: preview.content,
            added_lines,
            removed_lines,
        })
    }

    pub fn restore_version(
        &self,
        id: &str,
        mode: VersionRestoreMode,
    ) -> Result<VersionRestore, RecoveryError> {
        let _guard = recovery_guard()?;
        let preview = self.preview_version_unlocked(id)?;
        match mode {
            VersionRestoreMode::ReplaceCurrent => {
                let preserved = self.capture_snapshot_unlocked(
                    &preview.snapshot.note_path,
                    SnapshotReason::BeforeRestore,
                    true,
                )?;
                let current = self.vault.read_note(&preview.snapshot.note_path)?;
                let outcome = self.vault.save_note(
                    &preview.snapshot.note_path,
                    &preview.content,
                    &current.revision,
                )?;
                let crate::vault::SaveOutcome::Saved { document, .. } = outcome else {
                    return Err(RecoveryError::Conflict);
                };
                let preserved_snapshot_id = match preserved {
                    SnapshotCapture::Created(snapshot) => Some(snapshot.id),
                    SnapshotCapture::SkippedUnchanged | SnapshotCapture::SkippedInterval => None,
                };
                Ok(VersionRestore {
                    document,
                    preserved_snapshot_id,
                    restored_as_copy: false,
                })
            }
            VersionRestoreMode::Copy => {
                let document =
                    self.create_restored_copy(&preview.snapshot.note_path, &preview.content)?;
                Ok(VersionRestore {
                    document,
                    preserved_snapshot_id: None,
                    restored_as_copy: true,
                })
            }
        }
    }

    fn preview_version_unlocked(&self, id: &str) -> Result<VersionPreview, RecoveryError> {
        validate_recovery_id(id)?;
        let snapshot = self
            .scan_versions()?
            .remove(id)
            .ok_or(RecoveryError::NotFound)?;
        let normalized = validate_relative_note_path(&snapshot.note_path)?;
        let content_path = self
            .backups_root()
            .join(id)
            .join("content")
            .join(normalized);
        let canonical = content_path
            .canonicalize()
            .map_err(|_| RecoveryError::NotFound)?;
        let group = self.backups_root().join(id).canonicalize()?;
        if !canonical.starts_with(group) || !canonical.is_file() {
            return Err(RecoveryError::NotFound);
        }
        let content =
            String::from_utf8(fs::read(canonical)?).map_err(|_| RecoveryError::InvalidUtf8)?;
        Ok(VersionPreview { snapshot, content })
    }

    fn create_restored_copy(
        &self,
        note_path: &str,
        content: &str,
    ) -> Result<crate::vault::NoteDocument, RecoveryError> {
        let normalized = validate_relative_note_path(note_path)?;
        let parent = normalized.parent().unwrap_or_else(|| Path::new(""));
        let stem = normalized
            .file_stem()
            .ok_or(RecoveryError::NotFound)?
            .to_string_lossy();
        for attempt in 1..=10_000_u32 {
            let suffix = if attempt == 1 {
                " (restored)".to_owned()
            } else {
                format!(" (restored {attempt})")
            };
            let candidate = portable_path(&parent.join(format!("{stem}{suffix}.md")));
            match self.vault.create_note(&candidate, content) {
                Ok(document) => return Ok(document),
                Err(VaultError::Io(error)) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                }
                Err(error) => return Err(error.into()),
            }
        }
        Err(RecoveryError::Io(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "unable to create a collision-free restored copy",
        )))
    }

    fn list_trash_unlocked(&self) -> Result<Vec<TrashItem>, RecoveryError> {
        let mut items = Vec::new();
        for group in fs::read_dir(self.trash_root())? {
            let group = group?;
            if !group.file_type()?.is_dir() {
                continue;
            }
            let id = group.file_name().to_string_lossy().into_owned();
            if id.starts_with('.') || validate_recovery_id(&id).is_err() {
                continue;
            }
            if let Ok(item) = self.read_trash_item(&id, &group.path()) {
                items.push(item);
            }
        }
        items.sort_by(|left, right| {
            right
                .deleted_ms
                .cmp(&left.deleted_ms)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(items)
    }

    fn read_trash_item(&self, id: &str, group: &Path) -> Result<TrashItem, RecoveryError> {
        let metadata = fs::read(group.join("metadata.json"))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<TrashMetadata>(&bytes).ok());
        let original_path = metadata
            .as_ref()
            .map(|metadata| metadata.original_path.clone())
            .or_else(|| fs::read_to_string(group.join("original-path.txt")).ok())
            .map(|path| path.trim().to_owned())
            .ok_or(RecoveryError::NotFound)?;
        let normalized = validate_relative_entry_path(&original_path)?;
        let payload = group.join("payload").join(&normalized);
        let canonical = payload
            .canonicalize()
            .map_err(|_| RecoveryError::NotFound)?;
        let group_root = group.canonicalize()?;
        if !canonical.starts_with(group_root) {
            return Err(RecoveryError::NotFound);
        }
        let kind = if canonical.is_dir() { "folder" } else { "note" }.to_owned();
        let byte_length = if canonical.is_dir() {
            directory_size(&canonical)?
        } else {
            fs::metadata(canonical)?.len()
        };
        Ok(TrashItem {
            id: id.to_owned(),
            original_path: portable_path(&normalized),
            deleted_ms: metadata
                .as_ref()
                .map_or_else(|| timestamp_from_id(id), |metadata| metadata.deleted_ms),
            kind,
            byte_length,
        })
    }

    fn allocate_restored_path(
        &self,
        original: &Path,
        reserved: &BTreeSet<PathBuf>,
    ) -> Result<PathBuf, RecoveryError> {
        let parent = original.parent().unwrap_or_else(|| Path::new(""));
        let file_name = original
            .file_name()
            .ok_or(RecoveryError::NotFound)?
            .to_string_lossy();
        let original_path = Path::new(file_name.as_ref());
        let stem = original_path
            .file_stem()
            .ok_or(RecoveryError::NotFound)?
            .to_string_lossy();
        let extension = original_path.extension().and_then(|value| value.to_str());
        for attempt in 1..=10_000_u32 {
            let suffix = if attempt == 1 {
                " (restored)".to_owned()
            } else {
                format!(" (restored {attempt})")
            };
            let candidate_name = extension.map_or_else(
                || format!("{stem}{suffix}"),
                |extension| format!("{stem}{suffix}.{extension}"),
            );
            let candidate = parent.join(candidate_name);
            if let Ok(path) = self.vault.resolve_new_path(&candidate) {
                if reserved.contains(&path) {
                    continue;
                }
                return Ok(path);
            }
        }
        Err(RecoveryError::Io(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "unable to allocate a restored path",
        )))
    }

    fn delete_trash_group(&self, id: &str) -> Result<(), RecoveryError> {
        validate_recovery_id(id)?;
        let group = self.trash_root().join(id);
        let canonical = group.canonicalize().map_err(|_| RecoveryError::NotFound)?;
        let trash = self.trash_root().canonicalize()?;
        if !canonical.starts_with(&trash) || !canonical.is_dir() {
            return Err(RecoveryError::NotFound);
        }
        let temporary = self.trash_root().join(format!(".delete-{id}.serein-tmp"));
        fs::rename(canonical, &temporary)?;
        fs::remove_dir_all(temporary)?;
        Ok(())
    }

    fn reconcile_trash_transients(&self) -> Result<(), RecoveryError> {
        for entry in fs::read_dir(self.trash_root())? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(id) =
                transient_id(&name, ".trash-").or_else(|| transient_id(&name, ".restore-"))
            {
                let original_path = fs::read_to_string(entry.path().join("original-path.txt"))
                    .ok()
                    .map(|path| path.trim().to_owned());
                let payload_exists = original_path
                    .as_deref()
                    .and_then(|path| validate_relative_entry_path(path).ok())
                    .is_some_and(|path| entry.path().join("payload").join(path).exists());
                let final_group = self.trash_root().join(id);
                if payload_exists && !final_group.exists() {
                    fs::rename(entry.path(), final_group)?;
                } else if !payload_exists {
                    fs::remove_dir_all(entry.path())?;
                }
            } else if transient_id(&name, ".delete-").is_some() {
                fs::remove_dir_all(entry.path())?;
            }
        }
        Ok(())
    }

    fn remove_version_group(&self, id: &str) -> Result<(), RecoveryError> {
        validate_recovery_id(id)?;
        let group = self.backups_root().join(id);
        let canonical = group.canonicalize().map_err(|_| RecoveryError::NotFound)?;
        let backups = self.backups_root().canonicalize()?;
        if !canonical.starts_with(backups) || !canonical.is_dir() {
            return Err(RecoveryError::NotFound);
        }
        fs::remove_dir_all(canonical)?;
        Ok(())
    }

    fn list_versions_unlocked(
        &self,
        note_path: &str,
    ) -> Result<Vec<VersionSnapshot>, RecoveryError> {
        let normalized = portable_path(&validate_relative_note_path(note_path)?);
        let mut versions = self
            .scan_versions()?
            .into_values()
            .filter(|snapshot| snapshot.note_path == normalized)
            .collect::<Vec<_>>();
        versions.sort_by(|left, right| {
            right
                .created_ms
                .cmp(&left.created_ms)
                .then_with(|| right.id.cmp(&left.id))
        });
        Ok(versions)
    }

    fn scan_versions(&self) -> Result<BTreeMap<String, VersionSnapshot>, RecoveryError> {
        let mut versions = BTreeMap::new();
        for group in fs::read_dir(self.backups_root())? {
            let group = group?;
            if !group.file_type()?.is_dir() {
                continue;
            }
            let id = group.file_name().to_string_lossy().into_owned();
            if id.starts_with('.') || id == "conflicts" {
                continue;
            }
            let path = group.path();
            let metadata = fs::read(path.join("metadata.json"))
                .ok()
                .and_then(|bytes| serde_json::from_slice::<VersionMetadata>(&bytes).ok());
            let snapshot = if let Some(metadata) = metadata {
                VersionSnapshot {
                    id: id.clone(),
                    note_path: metadata.note_path,
                    created_ms: metadata.created_ms,
                    source_revision: metadata.source_revision,
                    byte_length: metadata.byte_length,
                    reason: metadata.reason,
                }
            } else {
                self.reconstruct_version(&id, &path)?
            };
            versions.insert(id, snapshot);
        }
        Ok(versions)
    }

    fn reconstruct_version(
        &self,
        id: &str,
        group: &Path,
    ) -> Result<VersionSnapshot, RecoveryError> {
        let content_root = group.join("content");
        let content = WalkDir::new(&content_root)
            .follow_links(false)
            .into_iter()
            .filter_map(Result::ok)
            .find(|entry| {
                entry.file_type().is_file()
                    && entry
                        .path()
                        .extension()
                        .is_some_and(|extension| extension.eq_ignore_ascii_case("md"))
            })
            .ok_or(RecoveryError::NotFound)?;
        let note_path = content
            .path()
            .strip_prefix(&content_root)
            .map_err(|_| RecoveryError::NotFound)?;
        let bytes = fs::read(content.path())?;
        Ok(VersionSnapshot {
            id: id.to_owned(),
            note_path: portable_path(note_path),
            created_ms: timestamp_from_id(id),
            source_revision: blake3::hash(&bytes).to_hex().to_string(),
            byte_length: bytes.len() as u64,
            reason: SnapshotReason::Manual,
        })
    }

    fn backups_root(&self) -> PathBuf {
        self.vault.root().join(INTERNAL_DIR).join("backups")
    }

    fn settings_path(&self) -> PathBuf {
        self.vault
            .root()
            .join(INTERNAL_DIR)
            .join("recovery-settings.json")
    }

    fn trash_root(&self) -> PathBuf {
        self.vault.root().join(INTERNAL_DIR).join("trash")
    }
}

fn recovery_guard() -> Result<MutexGuard<'static, ()>, RecoveryError> {
    RECOVERY_OPERATION_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| RecoveryError::Io(std::io::Error::other("recovery store is unavailable")))
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

fn recovery_id(now: u64) -> String {
    let serial = RECOVERY_ID_COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("{now}-{serial}")
}

fn timestamp_from_id(id: &str) -> u64 {
    id.split('-')
        .next()
        .and_then(|value| value.parse().ok())
        .unwrap_or_default()
}

fn validate_recovery_id(id: &str) -> Result<(), RecoveryError> {
    if id.is_empty()
        || id.len() > 80
        || !id.bytes().all(|byte| byte.is_ascii_digit() || byte == b'-')
    {
        return Err(RecoveryError::NotFound);
    }
    Ok(())
}

fn transient_id<'a>(name: &'a str, prefix: &str) -> Option<&'a str> {
    let id = name
        .strip_prefix(prefix)?
        .strip_suffix(".serein-tmp")
        .or_else(|| name.strip_prefix(prefix)?.strip_suffix(".hushnote-tmp"))
        .or_else(|| name.strip_prefix(prefix)?.strip_suffix(".writ-tmp"))?;
    validate_recovery_id(id).ok().map(|_| id)
}

fn changed_line_counts(current: &str, snapshot: &str) -> (usize, usize) {
    let mut current_counts = BTreeMap::<&str, usize>::new();
    let mut snapshot_counts = BTreeMap::<&str, usize>::new();
    for line in current.lines() {
        *current_counts.entry(line).or_default() += 1;
    }
    for line in snapshot.lines() {
        *snapshot_counts.entry(line).or_default() += 1;
    }
    let added = current_counts
        .iter()
        .map(|(line, count)| count.saturating_sub(*snapshot_counts.get(line).unwrap_or(&0)))
        .sum();
    let removed = snapshot_counts
        .iter()
        .map(|(line, count)| count.saturating_sub(*current_counts.get(line).unwrap_or(&0)))
        .sum();
    (added, removed)
}

fn write_synced(path: &Path, bytes: &[u8]) -> Result<(), RecoveryError> {
    let mut file = OpenOptions::new().create_new(true).write(true).open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    Ok(())
}

fn directory_size(path: &Path) -> Result<u64, RecoveryError> {
    let mut bytes = 0_u64;
    for entry in WalkDir::new(path).follow_links(false) {
        let entry = entry.map_err(|error| {
            RecoveryError::Io(
                error
                    .into_io_error()
                    .unwrap_or_else(|| std::io::Error::other("unable to inspect recovery storage")),
            )
        })?;
        if entry.file_type().is_file() {
            let metadata =
                entry.metadata().map_err(|error| {
                    RecoveryError::Io(error.into_io_error().unwrap_or_else(|| {
                        std::io::Error::other("unable to inspect a recovery file")
                    }))
                })?;
            bytes = bytes.saturating_add(metadata.len());
        }
    }
    Ok(bytes)
}
