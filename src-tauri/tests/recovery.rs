use std::fs;

use serein_lib::{
    recovery::{
        RecoverySettings, RecoveryStore, SnapshotCapture, SnapshotReason, TrashRestorePolicy,
        VersionRestoreMode,
    },
    search::SearchIndex,
    vault::{VaultEngine, SYNTHETIC_VAULT_MARKER},
};
use tempfile::TempDir;

fn marked_vault() -> (TempDir, VaultEngine) {
    let temp = tempfile::tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(SYNTHETIC_VAULT_MARKER),
        "serein synthetic vault v1\n",
    )
    .expect("marker");
    fs::create_dir_all(temp.path().join("Notes")).expect("notes");
    fs::create_dir_all(temp.path().join(".serein/backups")).expect("backups");
    fs::create_dir_all(temp.path().join(".serein/trash")).expect("trash");
    let vault = VaultEngine::open(temp.path()).expect("open marked vault");
    (temp, vault)
}

#[test]
fn history_survives_restart_and_restore_preserves_the_current_version() {
    let (temp, vault) = marked_vault();
    vault
        .create_note("Notes/History.md", "version one\n")
        .expect("note");
    let store = RecoveryStore::open(vault.clone()).expect("recovery store");
    let SnapshotCapture::Created(first) = store
        .capture_snapshot("Notes/History.md", SnapshotReason::Manual, true)
        .expect("first snapshot")
    else {
        panic!("expected snapshot");
    };
    let before = vault.read_note("Notes/History.md").expect("first version");
    vault
        .save_note("Notes/History.md", "version two\n", &before.revision)
        .expect("second version");
    drop(store);

    let reopened = RecoveryStore::open(VaultEngine::open(temp.path()).unwrap())
        .expect("reopened recovery store");
    let preview = reopened.preview_version(&first.id).expect("preview");
    assert_eq!(preview.content, "version one\n");
    let comparison = reopened.compare_version(&first.id).expect("comparison");
    assert_eq!(comparison.current_content, "version two\n");
    assert_eq!(comparison.snapshot_content, "version one\n");
    assert_eq!(comparison.added_lines, 1);
    assert_eq!(comparison.removed_lines, 1);

    let restored = reopened
        .restore_version(&first.id, VersionRestoreMode::ReplaceCurrent)
        .expect("restore old version");
    assert_eq!(restored.document.content, "version one\n");
    let versions = reopened.list_versions("Notes/History.md").unwrap();
    assert!(versions
        .iter()
        .any(|version| version.reason == SnapshotReason::BeforeRestore));

    fs::write(
        temp.path()
            .join(".serein/backups")
            .join(&first.id)
            .join("metadata.json"),
        b"corrupted metadata",
    )
    .expect("corrupt metadata");
    assert!(reopened
        .list_versions("Notes/History.md")
        .unwrap()
        .iter()
        .any(|version| version.id == first.id));
}

#[test]
fn restore_as_copy_never_replaces_the_current_note() {
    let (temp, vault) = marked_vault();
    vault
        .create_note("Notes/Copy.md", "old copy\n")
        .expect("note");
    let store = RecoveryStore::open(vault.clone()).expect("recovery store");
    let SnapshotCapture::Created(snapshot) = store
        .capture_snapshot("Notes/Copy.md", SnapshotReason::Manual, true)
        .expect("snapshot")
    else {
        panic!("expected snapshot");
    };
    let before = vault.read_note("Notes/Copy.md").unwrap();
    vault
        .save_note("Notes/Copy.md", "current copy\n", &before.revision)
        .unwrap();

    let restored = store
        .restore_version(&snapshot.id, VersionRestoreMode::Copy)
        .expect("restore as copy");

    assert_ne!(restored.document.relative_path, "Notes/Copy.md");
    assert_eq!(restored.document.content, "old copy\n");
    assert_eq!(
        fs::read_to_string(temp.path().join("Notes/Copy.md")).unwrap(),
        "current copy\n"
    );
}

#[test]
fn configurable_age_and_storage_cleanup_remove_old_snapshots_safely() {
    let (temp, vault) = marked_vault();
    vault
        .create_note("Notes/Cleanup.md", "one\n")
        .expect("note");
    let store = RecoveryStore::open(vault.clone()).expect("recovery store");
    let SnapshotCapture::Created(oldest) = store
        .capture_snapshot("Notes/Cleanup.md", SnapshotReason::Manual, true)
        .expect("oldest snapshot")
    else {
        panic!("expected snapshot");
    };
    for content in ["two\n", "three\n"] {
        let before = vault.read_note("Notes/Cleanup.md").unwrap();
        vault
            .save_note("Notes/Cleanup.md", content, &before.revision)
            .unwrap();
        store
            .capture_snapshot("Notes/Cleanup.md", SnapshotReason::Manual, true)
            .unwrap();
    }
    let metadata_path = temp
        .path()
        .join(".serein/backups")
        .join(&oldest.id)
        .join("metadata.json");
    let mut metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(&metadata_path).unwrap()).unwrap();
    metadata["created_ms"] = 1.into();
    fs::write(
        &metadata_path,
        serde_json::to_vec_pretty(&metadata).unwrap(),
    )
    .unwrap();

    let settings = RecoverySettings {
        snapshot_interval_minutes: 5,
        retention_days: 1,
        max_storage_bytes: 5,
        automatic_cleanup: true,
        trash_retention_days: None,
    };
    store.update_settings(settings.clone()).expect("settings");
    assert_eq!(store.settings().unwrap(), settings);

    let summary = store.cleanup().expect("cleanup");
    assert!(summary.removed_versions >= 2);
    assert!(summary.reclaimed_bytes >= 8);
    assert!(store.list_versions("Notes/Cleanup.md").unwrap().len() <= 1);
}

#[test]
fn multiple_edits_create_interval_snapshots_without_snapshot_spam() {
    let (_temp, vault) = marked_vault();
    vault
        .create_note("Notes/Chapter.md", "chapter one\n")
        .expect("note");
    let store = RecoveryStore::open(vault.clone()).expect("recovery store");

    let first = store
        .capture_snapshot("Notes/Chapter.md", SnapshotReason::Interval, false)
        .expect("first interval snapshot");
    assert!(matches!(first, SnapshotCapture::Created(_)));

    let before = vault.read_note("Notes/Chapter.md").expect("before edit");
    vault
        .save_note("Notes/Chapter.md", "chapter two\n", &before.revision)
        .expect("second edit");
    let throttled = store
        .capture_snapshot("Notes/Chapter.md", SnapshotReason::Interval, false)
        .expect("throttled snapshot");
    assert_eq!(throttled, SnapshotCapture::SkippedInterval);

    let forced = store
        .capture_snapshot("Notes/Chapter.md", SnapshotReason::Manual, true)
        .expect("manual snapshot");
    assert!(matches!(forced, SnapshotCapture::Created(_)));
    assert_eq!(store.list_versions("Notes/Chapter.md").unwrap().len(), 2);
}

#[test]
fn trash_lists_and_restores_notes_and_folder_trees_without_overwriting_occupants() {
    let (temp, vault) = marked_vault();
    vault
        .create_note("Notes/Deleted.md", "deleted note\n")
        .expect("note");
    vault.create_folder("Projects").expect("projects");
    vault.create_folder("Projects/Folder").expect("folder");
    vault
        .create_note("Projects/Folder/Nested.md", "nested\n")
        .expect("nested note");
    let store = RecoveryStore::open(vault.clone()).expect("recovery store");

    let note = store.trash_entry("Notes/Deleted.md").expect("trash note");
    let folder = store.trash_entry("Projects/Folder").expect("trash folder");
    let items = store.list_trash().expect("trash view");
    assert_eq!(items.len(), 2);
    assert_eq!(note.kind, "note");
    assert_eq!(folder.kind, "folder");
    assert!(folder.byte_length >= 7);

    let restored_note = store
        .restore_trash(std::slice::from_ref(&note.id), TrashRestorePolicy::Original)
        .expect("restore note");
    assert_eq!(restored_note[0].restored_path, "Notes/Deleted.md");
    assert_eq!(
        fs::read_to_string(temp.path().join("Notes/Deleted.md")).unwrap(),
        "deleted note\n"
    );

    vault
        .create_folder("Projects/Folder")
        .expect("occupied folder");
    vault
        .create_note("Projects/Folder/Occupant.md", "occupant\n")
        .unwrap();
    assert!(store
        .restore_trash(
            std::slice::from_ref(&folder.id),
            TrashRestorePolicy::Original
        )
        .is_err());
    let alternate = store
        .restore_trash(&[folder.id], TrashRestorePolicy::Alternate)
        .expect("safe alternate restore");
    assert_ne!(alternate[0].restored_path, "Projects/Folder");
    assert!(temp
        .path()
        .join(&alternate[0].restored_path)
        .join("Nested.md")
        .is_file());
    assert!(temp.path().join("Projects/Folder/Occupant.md").is_file());
}

#[test]
fn multi_restore_reserves_distinct_collision_safe_destinations() {
    let (temp, vault) = marked_vault();
    vault.create_note("Repeated.md", "first\n").unwrap();
    let store = RecoveryStore::open(vault.clone()).unwrap();
    let first = store.trash_entry("Repeated.md").unwrap();
    vault.create_note("Repeated.md", "second\n").unwrap();
    let second = store.trash_entry("Repeated.md").unwrap();

    let restored = store
        .restore_trash(&[first.id, second.id], TrashRestorePolicy::Alternate)
        .expect("restore both with distinct names");
    assert_eq!(restored.len(), 2);
    assert_ne!(restored[0].restored_path, restored[1].restored_path);
    assert!(temp.path().join(&restored[0].restored_path).is_file());
    assert!(temp.path().join(&restored[1].restored_path).is_file());
}

#[test]
fn permanent_delete_empty_trash_and_metadata_reconstruction_are_explicit() {
    let (temp, vault) = marked_vault();
    for name in ["One.md", "Two.md", "Three.md"] {
        vault.create_note(name, name).expect("note");
    }
    let store = RecoveryStore::open(vault.clone()).expect("recovery store");
    let one = store.trash_entry("One.md").unwrap();
    let two = store.trash_entry("Two.md").unwrap();
    let three = store.trash_entry("Three.md").unwrap();
    fs::write(
        temp.path()
            .join(".serein/trash")
            .join(&two.id)
            .join("metadata.json"),
        b"corrupt",
    )
    .expect("corrupt trash metadata");
    assert!(store
        .list_trash()
        .unwrap()
        .iter()
        .any(|item| item.id == two.id && item.original_path == "Two.md"));

    let deleted = store
        .delete_permanently(std::slice::from_ref(&one.id))
        .expect("permanent delete");
    assert_eq!(deleted, 1);
    assert!(!temp.path().join(".serein/trash").join(one.id).exists());
    assert_eq!(store.empty_trash().expect("empty trash"), 2);
    assert!(store.list_trash().unwrap().is_empty());
    assert!(!temp.path().join(".serein/trash").join(three.id).exists());

    assert!(vault
        .list_notes()
        .unwrap()
        .iter()
        .all(|note| !note.relative_path.starts_with(".serein/")));
    let index = SearchIndex::open(vault).expect("index");
    index.rebuild().expect("rebuild");
    assert!(index.search("Three", 20).unwrap().is_empty());
}

#[test]
fn interrupted_trash_move_is_reconciled_and_recovery_failures_abort_risky_work() {
    let (temp, vault) = marked_vault();
    vault.create_note("Interrupted.md", "recover me\n").unwrap();
    let interrupted_id = "1700000000000-77";
    let temporary = temp
        .path()
        .join(".serein/trash")
        .join(format!(".trash-{interrupted_id}.hushnote-tmp"));
    fs::create_dir_all(temporary.join("payload")).unwrap();
    fs::rename(
        temp.path().join("Interrupted.md"),
        temporary.join("payload/Interrupted.md"),
    )
    .unwrap();
    fs::write(temporary.join("original-path.txt"), "Interrupted.md").unwrap();
    fs::write(
        temporary.join("metadata.json"),
        r#"{"original_path":"Interrupted.md","deleted_ms":1700000000000,"kind":"note","byte_length":11}"#,
    )
    .unwrap();

    let reopened = RecoveryStore::open(VaultEngine::open(temp.path()).unwrap())
        .expect("reconcile interrupted trash");
    assert!(reopened
        .list_trash()
        .unwrap()
        .iter()
        .any(|item| item.id == interrupted_id));

    fs::remove_dir_all(temp.path().join(".serein/backups")).unwrap();
    fs::write(temp.path().join(".serein/backups"), b"locked recovery path").unwrap();
    assert!(RecoveryStore::open(vault).is_err());
}

#[test]
fn normal_saves_are_interval_snapshotted_and_risky_overwrites_abort_without_backup() {
    let (temp, vault) = marked_vault();
    vault.create_note("Safe.md", "first\n").unwrap();
    let store = RecoveryStore::open(vault.clone()).unwrap();
    let first = vault.read_note("Safe.md").unwrap();
    store
        .save_note("Safe.md", "second\n", &first.revision)
        .expect("autosave with snapshot");
    let second = vault.read_note("Safe.md").unwrap();
    store
        .save_note("Safe.md", "third\n", &second.revision)
        .expect("throttled autosave");
    assert_eq!(store.list_versions("Safe.md").unwrap().len(), 1);

    fs::remove_dir_all(temp.path().join(".serein/backups")).unwrap();
    fs::write(temp.path().join(".serein/backups"), b"blocked").unwrap();
    let third = vault.read_note("Safe.md").unwrap();
    assert!(vault
        .preserve_disk_and_save("Safe.md", "unsafe overwrite\n", &third.revision)
        .is_err());
    assert_eq!(
        fs::read_to_string(temp.path().join("Safe.md")).unwrap(),
        "third\n"
    );
}
