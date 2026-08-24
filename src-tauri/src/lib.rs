pub mod attachments;
pub mod preferences;
pub mod recovery;
pub mod search;
pub mod vault;
pub mod watch;

use std::{collections::HashMap, sync::Mutex};

use attachments::{
    AttachmentImport, AttachmentInventoryEntry, AttachmentIssue, AttachmentMoveResult,
    AttachmentSettings, AttachmentStore,
};
use preferences::{load_with_legacy_candidates, JsonLoad, JsonStore};
use recovery::{
    CleanupSummary, RecoverySettings, RecoveryStore, TrashItem, TrashRestorePolicy,
    TrashRestoreResult, VersionComparison, VersionPreview, VersionRestore, VersionRestoreMode,
    VersionSnapshot,
};
use search::{IndexStatus, IndexSummary, SearchIndex, SearchResult};
use tauri::{Emitter, Manager};
use vault::{
    create_synthetic_vault, revision_for_content, FolderEntry, NoteDocument, NoteEntry,
    PreservedSaveOutcome, SaveOutcome, TrashRecord, VaultEngine, VaultSnapshot, INTERNAL_DIR,
};
use watch::{VaultWatcher, WriteJournal};

#[derive(Default)]
struct WatchRegistry {
    watchers: Mutex<HashMap<String, VaultWatcher>>,
    journal: WriteJournal,
}

#[tauri::command]
fn app_status() -> &'static str {
    "ready"
}

#[tauri::command]
fn load_application_settings(app: tauri::AppHandle) -> Result<JsonLoad, String> {
    let current = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("settings.json");
    let config_root = app.path().config_dir().map_err(|error| error.to_string())?;
    let hushnote = config_root
        .join("io.hushnote.desktop")
        .join("settings.json");
    let writ = config_root.join("io.writ.desktop").join("settings.json");
    load_with_legacy_candidates(current, [hushnote, writ])
}

#[tauri::command]
fn save_application_settings(
    app: tauri::AppHandle,
    value: serde_json::Value,
) -> Result<(), String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?
        .join("settings.json");
    JsonStore::new(path).save(&value)
}

#[tauri::command]
fn load_vault_workspace_session(root: String) -> Result<JsonLoad, String> {
    let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
    JsonStore::new(
        vault
            .root()
            .join(INTERNAL_DIR)
            .join("workspace-session.json"),
    )
    .load()
}

#[tauri::command]
fn save_vault_workspace_session(root: String, value: serde_json::Value) -> Result<(), String> {
    let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
    JsonStore::new(
        vault
            .root()
            .join(INTERNAL_DIR)
            .join("workspace-session.json"),
    )
    .save(&value)
}

#[tauri::command]
fn create_test_vault() -> Result<VaultSnapshot, String> {
    create_synthetic_vault()
        .and_then(|vault| vault.snapshot())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn open_test_vault(root: String) -> Result<VaultSnapshot, String> {
    VaultEngine::open(root)
        .and_then(|vault| vault.snapshot())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_vault_notes(root: String) -> Result<Vec<NoteEntry>, String> {
    VaultEngine::open(root)
        .and_then(|vault| vault.list_notes())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn read_vault_note(root: String, relative_path: String) -> Result<NoteDocument, String> {
    VaultEngine::open(root)
        .and_then(|vault| vault.read_note(&relative_path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_vault_note(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    relative_path: String,
    content: String,
    expected_revision: String,
) -> Result<SaveOutcome, String> {
    let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
    let note_path = vault
        .root()
        .join(&relative_path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    state
        .journal
        .record(note_path.clone(), revision_for_content(&content));
    let result = RecoveryStore::open(vault)
        .and_then(|store| store.save_note(&relative_path, &content, &expected_revision))
        .map_err(|error| error.to_string())?;
    if matches!(result, SaveOutcome::Conflict { .. }) {
        state.journal.clear(&note_path);
    }
    Ok(result)
}

#[tauri::command]
fn preserve_and_save_vault_note(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    relative_path: String,
    content: String,
    expected_disk_revision: String,
) -> Result<PreservedSaveOutcome, String> {
    let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
    let note_path = vault
        .root()
        .join(&relative_path)
        .canonicalize()
        .map_err(|error| error.to_string())?;
    state
        .journal
        .record(note_path.clone(), revision_for_content(&content));
    let result = RecoveryStore::open(vault)
        .and_then(|store| {
            store.preserve_and_save(&relative_path, &content, &expected_disk_revision)
        })
        .map_err(|error| error.to_string())?;
    if matches!(result.outcome, SaveOutcome::Conflict { .. }) {
        state.journal.clear(&note_path);
    }
    Ok(result)
}

#[tauri::command]
fn save_vault_note_copy(
    root: String,
    relative_path: String,
    content: String,
) -> Result<NoteDocument, String> {
    VaultEngine::open(root)
        .and_then(|vault| vault.save_conflict_copy(&relative_path, &content))
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_vault_note(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    relative_path: String,
    content: String,
) -> Result<NoteDocument, String> {
    let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
    state.journal.record_any(vault.root().join(&relative_path));
    vault
        .create_note(&relative_path, &content)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn create_vault_folder(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    relative_path: String,
) -> Result<FolderEntry, String> {
    let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
    state.journal.record_any(vault.root().join(&relative_path));
    vault
        .create_folder(&relative_path)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn move_vault_entry(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    from: String,
    to: String,
) -> Result<(), String> {
    let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
    state.journal.record_any(vault.root().join(&from));
    state.journal.record_any(vault.root().join(&to));
    vault
        .move_entry(&from, &to)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn trash_vault_entry(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    relative_path: String,
) -> Result<TrashItem, String> {
    let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
    state.journal.record_any(vault.root().join(&relative_path));
    RecoveryStore::open(vault)
        .and_then(|store| store.trash_entry(&relative_path))
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_recovery_settings(root: String) -> Result<RecoverySettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        RecoveryStore::open(vault)
            .and_then(|store| store.settings())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn set_recovery_settings(
    root: String,
    settings: RecoverySettings,
) -> Result<RecoverySettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        RecoveryStore::open(vault)
            .and_then(|store| store.update_settings(settings))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_note_versions(
    root: String,
    relative_path: String,
) -> Result<Vec<VersionSnapshot>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        RecoveryStore::open(vault)
            .and_then(|store| store.list_versions(&relative_path))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn preview_note_version(root: String, id: String) -> Result<VersionPreview, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        RecoveryStore::open(vault)
            .and_then(|store| store.preview_version(&id))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn compare_note_version(root: String, id: String) -> Result<VersionComparison, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        RecoveryStore::open(vault)
            .and_then(|store| store.compare_version(&id))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn restore_note_version(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    id: String,
    mode: VersionRestoreMode,
) -> Result<VersionRestore, String> {
    let journal = state.journal.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        let store = RecoveryStore::open(vault).map_err(|error| error.to_string())?;
        let restored = store
            .restore_version(&id, mode)
            .map_err(|error| error.to_string())?;
        journal.record_any(store.root().join(&restored.document.relative_path));
        Ok(restored)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_recovery_trash(root: String) -> Result<Vec<TrashItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        RecoveryStore::open(vault)
            .and_then(|store| store.list_trash())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn restore_recovery_trash(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    ids: Vec<String>,
    policy: TrashRestorePolicy,
) -> Result<Vec<TrashRestoreResult>, String> {
    let journal = state.journal.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        let store = RecoveryStore::open(vault).map_err(|error| error.to_string())?;
        let restored = store
            .restore_trash(&ids, policy)
            .map_err(|error| error.to_string())?;
        for item in &restored {
            journal.record_any(store.root().join(&item.restored_path));
        }
        Ok(restored)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_recovery_trash(root: String, ids: Vec<String>) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        RecoveryStore::open(vault)
            .and_then(|store| store.delete_permanently(&ids))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn empty_recovery_trash(root: String) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        RecoveryStore::open(vault)
            .and_then(|store| store.empty_trash())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn cleanup_recovery(root: String) -> Result<CleanupSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        RecoveryStore::open(vault)
            .and_then(|store| store.cleanup())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn restore_vault_entry(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    record: TrashRecord,
) -> Result<(), String> {
    let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
    state
        .journal
        .record_any(vault.root().join(&record.original_path));
    vault
        .restore_trashed(&record)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn get_attachment_settings(root: String) -> Result<AttachmentSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        AttachmentStore::open(vault)
            .and_then(|store| store.settings())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn set_attachment_directory(
    root: String,
    directory: String,
) -> Result<AttachmentSettings, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        let mut store = AttachmentStore::open(vault).map_err(|error| error.to_string())?;
        store
            .configure(&directory)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn import_attachment_bytes(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    note_path: String,
    file_name: String,
    media_type: String,
    bytes: Vec<u8>,
) -> Result<AttachmentImport, String> {
    let journal = state.journal.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        let store = AttachmentStore::open(vault).map_err(|error| error.to_string())?;
        let imported = store
            .import_bytes(&note_path, &file_name, &media_type, &bytes)
            .map_err(|error| error.to_string())?;
        journal.record_any(store.root().join(&imported.relative_path));
        Ok(imported)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn import_attachment_path(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    note_path: String,
    source_path: String,
) -> Result<AttachmentImport, String> {
    let journal = state.journal.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        let store = AttachmentStore::open(vault).map_err(|error| error.to_string())?;
        let imported = store
            .import_path(&note_path, &source_path)
            .map_err(|error| error.to_string())?;
        journal.record_any(store.root().join(&imported.relative_path));
        Ok(imported)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn rollback_attachment_import(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    relative_path: String,
    rollback_token: String,
) -> Result<bool, String> {
    let journal = state.journal.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        let store = AttachmentStore::open(vault).map_err(|error| error.to_string())?;
        journal.record_any(store.root().join(&relative_path));
        store
            .rollback_import(&relative_path, &rollback_token)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn move_attachment_and_repair(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    from: String,
    to: String,
) -> Result<AttachmentMoveResult, String> {
    let journal = state.journal.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        let store = AttachmentStore::open(vault).map_err(|error| error.to_string())?;
        journal.record_any(store.root().join(&from));
        journal.record_any(store.root().join(&to));
        let moved = store
            .move_and_repair(&from, &to)
            .map_err(|error| error.to_string())?;
        for note in &moved.updated_notes {
            journal.record_any(store.root().join(&note.relative_path));
        }
        Ok(moved)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn scan_attachment_issues(root: String) -> Result<Vec<AttachmentIssue>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        AttachmentStore::open(vault)
            .and_then(|store| store.scan_issues())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn repair_attachment_issue(
    state: tauri::State<'_, WatchRegistry>,
    root: String,
    issue: AttachmentIssue,
) -> Result<NoteDocument, String> {
    let journal = state.journal.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        let store = AttachmentStore::open(vault).map_err(|error| error.to_string())?;
        journal.record_any(store.root().join(&issue.note_path));
        store
            .repair_issue(&issue)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_attachments(root: String) -> Result<Vec<AttachmentInventoryEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        AttachmentStore::open(vault)
            .and_then(|store| store.inventory())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn attachment_preview_path(root: String, relative_path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        AttachmentStore::open(vault)
            .and_then(|store| store.preview_path(&relative_path))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn start_vault_watch(
    app: tauri::AppHandle,
    state: tauri::State<'_, WatchRegistry>,
    root: String,
) -> Result<String, String> {
    let vault = VaultEngine::open(&root).map_err(|error| error.to_string())?;
    let watch_id = vault.root().to_string_lossy().into_owned();
    let app_for_events = app.clone();
    let watcher = VaultWatcher::start(vault, state.journal.clone(), move |change| {
        let _ = app_for_events.emit("vault://filesystem-change", change);
    })?;
    state
        .watchers
        .lock()
        .map_err(|_| "vault watcher registry is unavailable".to_owned())?
        .insert(watch_id.clone(), watcher);
    Ok(watch_id)
}

#[tauri::command]
fn stop_vault_watch(
    state: tauri::State<'_, WatchRegistry>,
    watch_id: String,
) -> Result<bool, String> {
    Ok(state
        .watchers
        .lock()
        .map_err(|_| "vault watcher registry is unavailable".to_owned())?
        .remove(&watch_id)
        .is_some())
}

#[tauri::command]
async fn sync_vault_search(root: String) -> Result<IndexSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        SearchIndex::open(vault)
            .and_then(|index| index.sync())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn rebuild_vault_search(root: String) -> Result<IndexSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        SearchIndex::open(vault)
            .and_then(|index| index.rebuild())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn update_vault_search_entry(
    root: String,
    relative_path: String,
    kind: String,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        SearchIndex::open(vault)
            .and_then(|index| index.update_path(&relative_path, &kind))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn search_vault(
    root: String,
    query: String,
    limit: usize,
) -> Result<Vec<SearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        SearchIndex::open(vault)
            .and_then(|index| index.search(&query, limit))
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn vault_search_status(root: String) -> Result<IndexStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let vault = VaultEngine::open(root).map_err(|error| error.to_string())?;
        SearchIndex::open(vault)
            .and_then(|index| index.status())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(WatchRegistry::default())
        .invoke_handler(tauri::generate_handler![
            app_status,
            load_application_settings,
            save_application_settings,
            load_vault_workspace_session,
            save_vault_workspace_session,
            create_test_vault,
            open_test_vault,
            list_vault_notes,
            read_vault_note,
            save_vault_note,
            preserve_and_save_vault_note,
            save_vault_note_copy,
            create_vault_note,
            create_vault_folder,
            move_vault_entry,
            trash_vault_entry,
            restore_vault_entry,
            get_recovery_settings,
            set_recovery_settings,
            list_note_versions,
            preview_note_version,
            compare_note_version,
            restore_note_version,
            list_recovery_trash,
            restore_recovery_trash,
            delete_recovery_trash,
            empty_recovery_trash,
            cleanup_recovery,
            get_attachment_settings,
            set_attachment_directory,
            import_attachment_bytes,
            import_attachment_path,
            rollback_attachment_import,
            move_attachment_and_repair,
            scan_attachment_issues,
            repair_attachment_issue,
            list_attachments,
            attachment_preview_path,
            start_vault_watch,
            stop_vault_watch,
            sync_vault_search,
            rebuild_vault_search,
            update_vault_search_entry,
            search_vault,
            vault_search_status
        ])
        .run(tauri::generate_context!())
        .expect("error while running Serein");
}
