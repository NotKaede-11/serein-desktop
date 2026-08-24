use std::{
    fs,
    sync::mpsc,
    time::{Duration, Instant},
};

use serein_lib::{
    vault::{
        revision_for_content, SaveOutcome, VaultEngine, VaultError, HUSHNOTE_INTERNAL_DIR,
        HUSHNOTE_SYNTHETIC_VAULT_MARKER, INTERNAL_DIR, LEGACY_INTERNAL_DIR,
        LEGACY_SYNTHETIC_VAULT_MARKER, SYNTHETIC_VAULT_MARKER,
    },
    watch::{ChangeOrigin, VaultChange, VaultWatcher, WriteJournal},
};
use tempfile::tempdir;

#[test]
fn legacy_writ_metadata_migrates_once_without_losing_recovery_files() {
    let temp = tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(LEGACY_SYNTHETIC_VAULT_MARKER),
        "writ-io synthetic vault v1\n",
    )
    .expect("legacy marker");
    fs::create_dir_all(temp.path().join(LEGACY_INTERNAL_DIR).join("backups"))
        .expect("legacy backups");
    fs::create_dir_all(temp.path().join(LEGACY_INTERNAL_DIR).join("trash")).expect("legacy trash");
    fs::write(
        temp.path()
            .join(LEGACY_INTERNAL_DIR)
            .join("backups/version.md"),
        "preserved\n",
    )
    .expect("legacy recovery file");

    let vault = VaultEngine::open(temp.path()).expect("legacy vault migrates safely");

    assert_eq!(
        vault.root(),
        temp.path().canonicalize().expect("canonical root")
    );
    assert!(!temp.path().join(LEGACY_INTERNAL_DIR).exists());
    assert!(!temp.path().join(LEGACY_SYNTHETIC_VAULT_MARKER).exists());
    assert!(temp.path().join(SYNTHETIC_VAULT_MARKER).is_file());
    assert_eq!(
        fs::read_to_string(temp.path().join(INTERNAL_DIR).join("backups/version.md"))
            .expect("migrated recovery file"),
        "preserved\n"
    );
}

#[test]
fn hushnote_metadata_migrates_to_serein_without_losing_vault_state() {
    let temp = tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(HUSHNOTE_SYNTHETIC_VAULT_MARKER),
        "hushnote synthetic vault v1\n",
    )
    .expect("Hushnote marker");
    for directory in ["backups", "trash"] {
        fs::create_dir_all(temp.path().join(HUSHNOTE_INTERNAL_DIR).join(directory))
            .expect("legacy recovery directory");
    }
    fs::write(
        temp.path()
            .join(HUSHNOTE_INTERNAL_DIR)
            .join("backups/version.md"),
        "preserved backup\n",
    )
    .expect("legacy backup");
    fs::write(
        temp.path()
            .join(HUSHNOTE_INTERNAL_DIR)
            .join("trash/record.json"),
        "{\"originalPath\":\"Draft.md\"}\n",
    )
    .expect("legacy trash metadata");
    fs::write(
        temp.path().join(HUSHNOTE_INTERNAL_DIR).join("index.db"),
        b"index",
    )
    .expect("legacy index");
    fs::write(
        temp.path()
            .join(HUSHNOTE_INTERNAL_DIR)
            .join("workspace-session.json"),
        "{\"tabs\":[\"Draft.md\"]}\n",
    )
    .expect("legacy session");

    VaultEngine::open(temp.path()).expect("Hushnote vault migrates safely");

    assert!(!temp.path().join(HUSHNOTE_INTERNAL_DIR).exists());
    assert!(!temp.path().join(HUSHNOTE_SYNTHETIC_VAULT_MARKER).exists());
    assert!(temp.path().join(SYNTHETIC_VAULT_MARKER).is_file());
    assert_eq!(
        fs::read_to_string(temp.path().join(INTERNAL_DIR).join("backups/version.md")).unwrap(),
        "preserved backup\n"
    );
    assert!(temp
        .path()
        .join(INTERNAL_DIR)
        .join("trash/record.json")
        .is_file());
    assert_eq!(
        fs::read(temp.path().join(INTERNAL_DIR).join("index.db")).unwrap(),
        b"index"
    );
    assert!(temp
        .path()
        .join(INTERNAL_DIR)
        .join("workspace-session.json")
        .is_file());
}

#[test]
fn metadata_migration_stops_when_legacy_and_current_directories_both_exist() {
    let temp = tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(SYNTHETIC_VAULT_MARKER),
        "serein synthetic vault v1\n",
    )
    .expect("current marker");
    fs::create_dir(temp.path().join(HUSHNOTE_INTERNAL_DIR)).expect("legacy metadata");
    fs::create_dir(temp.path().join(INTERNAL_DIR)).expect("current metadata");

    let error = VaultEngine::open(temp.path()).expect_err("conflict must preserve both versions");

    assert!(matches!(error, VaultError::InternalMetadataConflict));
    assert!(temp.path().join(HUSHNOTE_INTERNAL_DIR).is_dir());
    assert!(temp.path().join(INTERNAL_DIR).is_dir());
}

#[test]
fn generated_vault_contains_only_synthetic_notes_and_hidden_internal_storage() {
    let vault = serein_lib::vault::create_synthetic_vault().expect("generated vault");
    let root = vault.root().to_path_buf();
    let notes = vault.list_notes().expect("generated notes");

    assert_eq!(notes.len(), 2);
    assert!(notes
        .iter()
        .all(|note| !note.relative_path.starts_with(".serein/")));
    assert!(root.join(".serein").join("backups").is_dir());
    assert!(root.join(".serein").join("trash").is_dir());
    let folders = vault.list_folders().expect("generated folders");
    assert!(folders
        .iter()
        .any(|folder| folder.relative_path == "Attachments"));
    assert!(folders
        .iter()
        .all(|folder| !folder.relative_path.starts_with(".serein")));

    drop(vault);
    fs::remove_dir_all(root).expect("clean generated test vault");
}

#[test]
fn explorer_operations_create_move_trash_and_restore_without_leaving_the_vault() {
    let temp = tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(SYNTHETIC_VAULT_MARKER),
        "serein synthetic vault v1\n",
    )
    .expect("synthetic marker");
    fs::create_dir_all(temp.path().join(".serein").join("trash")).expect("trash directory");
    fs::create_dir_all(temp.path().join(".serein").join("backups")).expect("backup directory");
    let vault = VaultEngine::open(temp.path()).expect("marked vault");

    vault.create_folder("Projects").expect("projects folder");
    vault
        .create_note("Projects/Draft.md", "# Draft\n")
        .expect("draft note");
    vault.create_folder("Archive").expect("archive folder");
    vault
        .move_entry("Projects/Draft.md", "Archive/Draft.md")
        .expect("move note");
    assert_eq!(
        fs::read_to_string(temp.path().join("Archive").join("Draft.md")).expect("moved note"),
        "# Draft\n"
    );

    let trashed = vault
        .trash_entry("Archive/Draft.md")
        .expect("recoverable delete");
    assert!(!temp.path().join("Archive").join("Draft.md").exists());
    assert!(temp.path().join(&trashed.trashed_path).is_file());
    assert!(trashed.trashed_path.starts_with(".serein/trash/"));

    vault.restore_trashed(&trashed).expect("restore note");
    assert!(temp.path().join("Archive").join("Draft.md").is_file());
    assert!(!temp.path().join(&trashed.trashed_path).exists());

    assert!(vault.create_note("../Outside.md", "blocked").is_err());
    assert!(vault.create_folder(".serein/visible").is_err());
    assert!(vault
        .move_entry("Archive/Draft.md", "../../Outside.md")
        .is_err());
    assert!(vault.trash_entry(".serein/backups").is_err());
}

#[test]
fn restoring_trash_never_overwrites_a_new_file_at_the_original_path() {
    let temp = tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(SYNTHETIC_VAULT_MARKER),
        "serein synthetic vault v1\n",
    )
    .expect("synthetic marker");
    fs::create_dir_all(temp.path().join(".serein").join("trash")).expect("trash directory");
    fs::create_dir_all(temp.path().join(".serein").join("backups")).expect("backup directory");
    fs::write(temp.path().join("Plan.md"), "trashed version\n").expect("original note");
    let vault = VaultEngine::open(temp.path()).expect("marked vault");

    let record = vault.trash_entry("Plan.md").expect("trash original");
    fs::write(temp.path().join("Plan.md"), "new occupant\n").expect("replacement note");
    assert!(vault.restore_trashed(&record).is_err());
    assert_eq!(
        fs::read_to_string(temp.path().join("Plan.md")).expect("occupied original path"),
        "new occupant\n"
    );
    assert_eq!(
        fs::read_to_string(temp.path().join(&record.trashed_path)).expect("preserved trash"),
        "trashed version\n"
    );
}

#[test]
fn explicit_conflict_resolution_preserves_the_displaced_disk_version() {
    let temp = tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(SYNTHETIC_VAULT_MARKER),
        "serein synthetic vault v1\n",
    )
    .expect("synthetic marker");
    fs::create_dir_all(temp.path().join(".serein").join("backups")).expect("backup directory");
    fs::create_dir_all(temp.path().join(".serein").join("trash")).expect("trash directory");
    fs::write(temp.path().join("Shared.md"), "disk version\n").expect("shared note");
    let vault = VaultEngine::open(temp.path()).expect("marked vault");
    let disk = vault.read_note("Shared.md").expect("disk version");

    let resolved = vault
        .preserve_disk_and_save("Shared.md", "local version\n", &disk.revision)
        .expect("keep mine resolution");
    assert!(matches!(resolved.outcome, SaveOutcome::Saved { .. }));
    assert_eq!(
        fs::read_to_string(temp.path().join("Shared.md")).expect("resolved note"),
        "local version\n"
    );
    assert_eq!(
        fs::read_to_string(temp.path().join(&resolved.backup_path))
            .expect("preserved disk version"),
        "disk version\n"
    );

    let copy = vault
        .save_conflict_copy("Shared.md", "second local branch\n")
        .expect("save both copy");
    assert_ne!(copy.relative_path, "Shared.md");
    assert_eq!(
        fs::read_to_string(temp.path().join(&copy.relative_path)).expect("conflict copy"),
        "second local branch\n"
    );
}

#[test]
fn opens_a_marked_synthetic_vault_and_reads_markdown() {
    let temp = tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(SYNTHETIC_VAULT_MARKER),
        "serein synthetic vault v1\n",
    )
    .expect("synthetic marker");
    fs::create_dir(temp.path().join("Notes")).expect("notes directory");
    fs::write(
        temp.path().join("Notes").join("Welcome.md"),
        "# Welcome\n\nSynthetic content.\n",
    )
    .expect("sample note");

    let vault = VaultEngine::open(temp.path()).expect("marked vault should open");
    let notes = vault.list_notes().expect("notes should list");
    let note = vault
        .read_note("Notes/Welcome.md")
        .expect("note should read");

    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].relative_path, "Notes/Welcome.md");
    assert_eq!(note.content, "# Welcome\n\nSynthetic content.\n");
    assert!(!note.revision.is_empty());
}

#[test]
fn atomically_saves_when_the_expected_revision_matches() {
    let temp = tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(SYNTHETIC_VAULT_MARKER),
        "serein synthetic vault v1\n",
    )
    .expect("synthetic marker");
    fs::write(temp.path().join("Draft.md"), "first\n").expect("sample note");
    let vault = VaultEngine::open(temp.path()).expect("marked vault should open");
    let before = vault.read_note("Draft.md").expect("initial note");

    let result = vault
        .save_note("Draft.md", "second\n", &before.revision)
        .expect("matching revision should save");

    let SaveOutcome::Saved { document, .. } = result else {
        panic!("expected a saved result");
    };
    assert_eq!(document.content, "second\n");
    assert_ne!(document.revision, before.revision);
    assert_eq!(
        fs::read_to_string(temp.path().join("Draft.md")).expect("saved file"),
        "second\n"
    );
    assert!(fs::read_dir(temp.path())
        .expect("vault entries")
        .all(|entry| !entry
            .expect("entry")
            .file_name()
            .to_string_lossy()
            .contains("serein-tmp")));
}

#[test]
fn protects_the_external_disk_version_when_revisions_diverge() {
    let temp = tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(SYNTHETIC_VAULT_MARKER),
        "serein synthetic vault v1\n",
    )
    .expect("synthetic marker");
    fs::write(temp.path().join("Shared.md"), "Serein draft\n").expect("sample note");
    let vault = VaultEngine::open(temp.path()).expect("marked vault should open");
    let serein_version = vault.read_note("Shared.md").expect("initial note");

    fs::write(temp.path().join("Shared.md"), "External editor version\n").expect("external edit");
    let result = vault
        .save_note(
            "Shared.md",
            "Unsaved Serein version\n",
            &serein_version.revision,
        )
        .expect("conflict result");

    let SaveOutcome::Conflict { disk, .. } = result else {
        panic!("expected conflict protection");
    };
    assert_eq!(disk.content, "External editor version\n");
    assert_eq!(
        fs::read_to_string(temp.path().join("Shared.md")).expect("disk version"),
        "External editor version\n"
    );
}

#[test]
fn rejects_unmarked_folders_and_parent_path_traversal() {
    let unmarked = tempdir().expect("unmarked directory");
    assert!(VaultEngine::open(unmarked.path()).is_err());

    let marked = tempdir().expect("marked directory");
    fs::write(
        marked.path().join(SYNTHETIC_VAULT_MARKER),
        "serein synthetic vault v1\n",
    )
    .expect("synthetic marker");
    let vault = VaultEngine::open(marked.path()).expect("marked vault");
    assert!(vault.read_note("../Outside.md").is_err());
}

#[test]
fn watcher_distinguishes_external_edits_from_serein_atomic_saves() {
    let temp = tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(SYNTHETIC_VAULT_MARKER),
        "serein synthetic vault v1\n",
    )
    .expect("synthetic marker");
    fs::write(temp.path().join("Watched.md"), "initial\n").expect("sample note");
    let vault = VaultEngine::open(temp.path()).expect("marked vault");
    let journal = WriteJournal::default();
    let (sender, receiver) = mpsc::channel();
    let _watcher = VaultWatcher::start(vault.clone(), journal.clone(), move |change| {
        let _ = sender.send(change);
    })
    .expect("watcher should start");
    std::thread::sleep(Duration::from_millis(100));

    fs::write(temp.path().join("Watched.md"), "external\n").expect("external edit");
    let external = receive_change(&receiver, ChangeOrigin::External);
    assert_eq!(external.relative_path, "Watched.md");

    let before = vault.read_note("Watched.md").expect("external version");
    let serein_content = "saved by Serein\n";
    journal.record(
        temp.path()
            .join("Watched.md")
            .canonicalize()
            .expect("note path"),
        revision_for_content(serein_content),
    );
    let result = vault
        .save_note("Watched.md", serein_content, &before.revision)
        .expect("Serein save");
    assert!(matches!(result, SaveOutcome::Saved { .. }));
    let own_change = receive_change(&receiver, ChangeOrigin::Serein);
    assert_eq!(own_change.relative_path, "Watched.md");
}

fn receive_change(receiver: &mpsc::Receiver<VaultChange>, expected: ChangeOrigin) -> VaultChange {
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        let change = receiver
            .recv_timeout(remaining)
            .expect("matching filesystem event");
        if change.origin == expected {
            return change;
        }
    }
}
