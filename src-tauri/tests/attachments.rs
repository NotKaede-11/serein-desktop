use std::{fs, path::Path, time::Instant};

use serein_lib::{
    attachments::AttachmentStore,
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
    fs::create_dir(temp.path().join("Notes")).expect("notes");
    fs::create_dir(temp.path().join("Attachments")).expect("attachments");
    fs::create_dir_all(temp.path().join(".serein").join("backups")).expect("backups");
    fs::create_dir_all(temp.path().join(".serein").join("trash")).expect("trash");
    let vault = VaultEngine::open(temp.path()).expect("open marked vault");
    (temp, vault)
}

#[test]
fn pasted_images_are_atomic_collision_safe_and_relative_to_the_note() {
    let (temp, vault) = marked_vault();
    fs::create_dir_all(temp.path().join("Notes/deep/topic")).expect("nested notes");
    vault
        .create_note("Notes/deep/topic/SyntheticTopic.md", "# Synthetic Topic\n")
        .expect("note");
    let store = AttachmentStore::open(vault).expect("attachment store");

    let first = store
        .import_bytes(
            "Notes/deep/topic/SyntheticTopic.md",
            "lab<result>?.png",
            "image/png",
            b"\x89PNG synthetic one",
        )
        .expect("first image");
    let second = store
        .import_bytes(
            "Notes/deep/topic/SyntheticTopic.md",
            "lab<result>?.png",
            "image/png",
            b"\x89PNG synthetic two",
        )
        .expect("collision image");

    assert_eq!(first.relative_path, "Attachments/lab_result__.png");
    assert_eq!(second.relative_path, "Attachments/lab_result__-2.png");
    assert_eq!(
        first.markdown,
        "![lab_result__](../../../Attachments/lab_result__.png)"
    );
    assert_eq!(
        fs::read(temp.path().join(&first.relative_path)).unwrap(),
        b"\x89PNG synthetic one"
    );
    assert_eq!(
        fs::read(temp.path().join(&second.relative_path)).unwrap(),
        b"\x89PNG synthetic two"
    );
    assert!(!temp
        .path()
        .join("Attachments/.lab_result__.png.serein-tmp")
        .exists());
}

#[test]
fn outside_and_inside_vault_files_are_copied_without_modifying_the_source() {
    let (temp, vault) = marked_vault();
    vault
        .create_note("Notes/Files.md", "# Files\n")
        .expect("note");
    let outside = tempfile::tempdir().expect("outside directory");
    let pdf = outside.path().join("Lecture notes 📚.pdf");
    fs::write(&pdf, b"synthetic pdf").expect("pdf");
    let inside = temp.path().join("Attachments/already-here.zip");
    fs::write(&inside, b"synthetic archive").expect("archive");
    let store = AttachmentStore::open(vault).expect("attachment store");

    let imported = store
        .import_path("Notes/Files.md", &pdf)
        .expect("outside import");
    let existing = store
        .import_path("Notes/Files.md", &inside)
        .expect("inside attachment");

    assert_eq!(
        imported.markdown,
        "[Lecture notes 📚](../Attachments/Lecture%20notes%20%F0%9F%93%9A.pdf)"
    );
    assert_eq!(fs::read(&pdf).unwrap(), b"synthetic pdf");
    assert_eq!(existing.relative_path, "Attachments/already-here.zip");
    assert!(!existing.created);
    assert!(existing.rollback_token.is_none());
}

#[test]
fn configurable_directory_rejects_internal_and_traversal_paths() {
    let (_temp, vault) = marked_vault();
    let mut store = AttachmentStore::open(vault).expect("attachment store");

    let configured = store
        .configure("Media/Clinical Images")
        .expect("safe nested directory");
    assert_eq!(configured.directory, "Media/Clinical Images");
    assert!(store.configure("../outside").is_err());
    assert!(store.configure(".serein/backups").is_err());
    assert!(store
        .import_bytes("../outside.md", "image.png", "image/png", b"png")
        .is_err());
}

#[test]
fn changing_the_default_directory_keeps_catalogued_attachments_manageable() {
    let (temp, vault) = marked_vault();
    vault
        .create_note("Notes/History.md", "![old](../Attachments/old.png)\n")
        .expect("note");
    let mut store = AttachmentStore::open(vault).expect("attachment store");
    let old = store
        .import_bytes("Notes/History.md", "old.png", "image/png", b"old image")
        .expect("old attachment");

    store.configure("Media").expect("new attachment directory");
    let new = store
        .import_bytes("Notes/History.md", "new.png", "image/png", b"new image")
        .expect("new attachment");

    assert_eq!(old.relative_path, "Attachments/old.png");
    assert_eq!(new.relative_path, "Media/new.png");
    assert_eq!(
        Path::new(&store.preview_path(&old.relative_path).expect("old preview"))
            .canonicalize()
            .expect("canonical preview"),
        temp.path()
            .join("Attachments/old.png")
            .canonicalize()
            .expect("canonical attachment")
    );
    let inventory = store.inventory().expect("combined inventory");
    assert!(inventory
        .iter()
        .any(|entry| entry.relative_path == old.relative_path));
    assert!(inventory
        .iter()
        .any(|entry| entry.relative_path == new.relative_path));
}

#[test]
fn internal_files_never_appear_in_the_orphan_review_inventory() {
    let (temp, vault) = marked_vault();
    fs::write(
        temp.path().join(".serein/backups/private.png"),
        b"internal image",
    )
    .expect("internal file");
    fs::write(temp.path().join("Attachments/public.png"), b"public image").expect("public file");
    let store = AttachmentStore::open(vault).expect("attachment store");

    let inventory = store.inventory().expect("inventory");

    assert_eq!(inventory.len(), 1);
    assert_eq!(inventory[0].relative_path, "Attachments/public.png");
}

#[test]
fn failed_editor_insertion_can_roll_back_only_the_unchanged_import() {
    let (temp, vault) = marked_vault();
    vault
        .create_note("Notes/Rollback.md", "# Rollback\n")
        .expect("note");
    let store = AttachmentStore::open(vault).expect("attachment store");
    let imported = store
        .import_bytes(
            "Notes/Rollback.md",
            "pasted-image.jpeg",
            "image/jpeg",
            b"jpeg bytes",
        )
        .expect("image import");
    let token = imported.rollback_token.as_deref().expect("rollback token");

    assert!(store
        .rollback_import(&imported.relative_path, token)
        .expect("rollback"));
    assert!(!temp.path().join(&imported.relative_path).exists());

    let changed = store
        .import_bytes(
            "Notes/Rollback.md",
            "changed.png",
            "image/png",
            b"original bytes",
        )
        .expect("second import");
    fs::write(
        temp.path().join(&changed.relative_path),
        b"externally changed",
    )
    .expect("external edit");
    assert!(!store
        .rollback_import(
            &changed.relative_path,
            changed.rollback_token.as_deref().unwrap(),
        )
        .expect("safe refusal"));
    assert_eq!(
        fs::read(temp.path().join(&changed.relative_path)).unwrap(),
        b"externally changed"
    );
}

#[test]
fn failed_attachment_write_does_not_change_the_note_or_leave_a_link() {
    let (temp, vault) = marked_vault();
    let note = vault
        .create_note("Notes/Write failure.md", "# Still intact\n")
        .expect("note");
    let store = AttachmentStore::open(vault.clone()).expect("attachment store");
    fs::remove_dir(temp.path().join("Attachments")).expect("remove empty attachment directory");
    fs::write(
        temp.path().join("Attachments"),
        b"directory path is locked by a file",
    )
    .expect("blocking file");

    assert!(store
        .import_bytes(
            "Notes/Write failure.md",
            "failed.png",
            "image/png",
            b"image bytes",
        )
        .is_err());

    let after = vault
        .read_note("Notes/Write failure.md")
        .expect("unchanged note");
    assert_eq!(after.content, note.content);
    assert!(!after.content.contains("failed.png"));
}

#[test]
fn moving_an_attachment_updates_known_markdown_references_atomically() {
    let (temp, vault) = marked_vault();
    fs::create_dir_all(temp.path().join("Notes/deep")).expect("nested notes");
    vault
        .create_note(
            "Notes/deep/Clinical.md",
            "# Clinical\n\n![scan](../../Attachments/scan.png)\n",
        )
        .expect("nested note");
    vault
        .create_note("Notes/Index.md", "[scan](../Attachments/scan.png)\n")
        .expect("root note");
    fs::write(temp.path().join("Attachments/scan.png"), b"scan bytes").expect("attachment");
    let store = AttachmentStore::open(vault).expect("attachment store");

    let moved = store
        .move_and_repair("Attachments/scan.png", "Attachments/Imaging/scan final.png")
        .expect("move and repair");

    assert_eq!(moved.relative_path, "Attachments/Imaging/scan final.png");
    assert_eq!(moved.updated_notes.len(), 2);
    assert!(!temp.path().join("Attachments/scan.png").exists());
    assert_eq!(
        fs::read_to_string(temp.path().join("Notes/deep/Clinical.md")).unwrap(),
        "# Clinical\n\n![scan](../../Attachments/Imaging/scan%20final.png)\n"
    );
    assert_eq!(
        fs::read_to_string(temp.path().join("Notes/Index.md")).unwrap(),
        "[scan](../Attachments/Imaging/scan%20final.png)\n"
    );
}

#[test]
fn external_rename_produces_a_hash_verified_repair_suggestion() {
    let (temp, vault) = marked_vault();
    vault
        .create_note(
            "Notes/External.md",
            "![diagram](../Attachments/diagram.png)\n",
        )
        .expect("note");
    let store = AttachmentStore::open(vault.clone()).expect("attachment store");
    let imported = store
        .import_bytes(
            "Notes/External.md",
            "diagram.png",
            "image/png",
            b"unique diagram bytes",
        )
        .expect("catalogued attachment");
    fs::rename(
        temp.path().join(&imported.relative_path),
        temp.path().join("Attachments/renamed diagram.png"),
    )
    .expect("external rename");

    let issues = store.scan_issues().expect("broken link scan");
    assert_eq!(issues.len(), 1);
    assert_eq!(issues[0].note_path, "Notes/External.md");
    assert_eq!(issues[0].broken_target, "../Attachments/diagram.png");
    assert_eq!(
        issues[0].suggested_path.as_deref(),
        Some("Attachments/renamed diagram.png")
    );
    let repaired = store.repair_issue(&issues[0]).expect("repair reference");
    assert_eq!(
        repaired.content,
        "![diagram](../Attachments/renamed%20diagram.png)\n"
    );
}

#[test]
fn attachment_names_remain_searchable_after_deleting_the_index() {
    let (temp, vault) = marked_vault();
    let note = vault
        .create_note("Notes/Search.md", "# Attachments\n")
        .expect("note");
    let store = AttachmentStore::open(vault.clone()).expect("attachment store");
    let imported = store
        .import_bytes(
            "Notes/Search.md",
            "project-aurora.png",
            "image/png",
            b"cbc image",
        )
        .expect("attachment");
    let content = format!("{}\n{}\n", note.content, imported.markdown);
    vault
        .save_note("Notes/Search.md", &content, &note.revision)
        .expect("save link");
    let index = SearchIndex::open(vault).expect("search index");
    index.rebuild().expect("initial rebuild");
    fs::remove_file(index.database_path()).expect("delete disposable index");

    let reopened =
        SearchIndex::open(VaultEngine::open(temp.path()).unwrap()).expect("reopen index");
    reopened.sync().expect("rebuild missing index");
    let results = reopened
        .search("project-aurora", 10)
        .expect("search attachment");
    assert_eq!(results[0].relative_path, "Notes/Search.md");
}

#[test]
fn large_external_file_import_streams_to_disk_and_keeps_the_source_intact() {
    let (_temp, vault) = marked_vault();
    vault
        .create_note("Notes/Large.md", "# Large\n")
        .expect("note");
    let outside = tempfile::tempdir().expect("outside");
    let source = outside.path().join("recording.mp4");
    let payload = vec![0x5a; 24 * 1024 * 1024];
    fs::write(&source, &payload).expect("large source");
    let store = AttachmentStore::open(vault).expect("attachment store");
    let started = Instant::now();

    let imported = store
        .import_path("Notes/Large.md", &source)
        .expect("large import");

    assert!(started.elapsed().as_secs() < 30);
    assert_eq!(fs::metadata(&source).unwrap().len(), payload.len() as u64);
    assert_eq!(
        fs::metadata(Path::new(store.root()).join(&imported.relative_path))
            .unwrap()
            .len(),
        payload.len() as u64
    );
}
