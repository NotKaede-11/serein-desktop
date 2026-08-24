use std::{fs, time::Instant};

use serein_lib::{
    search::SearchIndex,
    vault::{VaultEngine, SYNTHETIC_VAULT_MARKER},
};
use tempfile::tempdir;

fn marked_vault() -> (tempfile::TempDir, VaultEngine) {
    let temp = tempdir().expect("temporary vault");
    fs::write(
        temp.path().join(SYNTHETIC_VAULT_MARKER),
        "serein synthetic vault v1\n",
    )
    .expect("synthetic marker");
    fs::create_dir_all(temp.path().join(".serein").join("backups")).expect("backup directory");
    fs::create_dir_all(temp.path().join(".serein").join("trash")).expect("trash directory");
    let vault = VaultEngine::open(temp.path()).expect("marked vault");
    (temp, vault)
}

#[test]
fn rebuild_indexes_markdown_fields_and_returns_highlighted_context() {
    let (_temp, vault) = marked_vault();
    vault.create_folder("Topics").expect("topics folder");
    vault
        .create_note(
            "Topics/SyntheticTopic.md",
            "---\nkind: generated-example\ntags: [synthetic]\n---\n# Synthetic topic\n\nPlaceholder text for a generated search fixture. #synthetic\n\n- [ ] Review example\n\n[Reference](../Attachments/example-reference.pdf)\n",
        )
        .expect("indexed note");

    let index = SearchIndex::open(vault.clone()).expect("search index");
    let summary = index.rebuild().expect("index rebuild");
    assert_eq!(summary.indexed_notes, 1);
    assert!(index.database_path().ends_with(".serein/index.db"));

    for query in [
        "SyntheticTopic",
        "Topics",
        "Synthetic topic",
        "generated-example",
        "synthetic",
        "Review example",
        "example-reference.pdf",
    ] {
        let matches = index.search(query, 20).expect("search query");
        assert_eq!(matches.len(), 1, "query should match: {query}");
        assert_eq!(matches[0].relative_path, "Topics/SyntheticTopic.md");
        assert!(matches[0].snippet.iter().any(|span| span.matched));
    }
}

#[test]
fn sync_is_incremental_and_a_deleted_database_is_safely_rebuilt() {
    let (_temp, vault) = marked_vault();
    let initial = vault
        .create_note("Notes.md", "# Original\n\nalpha\n")
        .expect("initial note");
    let index = SearchIndex::open(vault.clone()).expect("search index");
    index.rebuild().expect("initial rebuild");

    vault
        .save_note("Notes.md", "# Revised\n\nbeta\n", &initial.revision)
        .expect("revised note");
    let changed = index.sync().expect("incremental sync");
    assert_eq!(changed.updated_notes, 1);
    assert!(index.search("alpha", 10).expect("old query").is_empty());
    assert_eq!(index.search("beta", 10).expect("new query").len(), 1);

    fs::remove_file(index.database_path()).expect("delete disposable index");
    let rebuilt = index.sync().expect("missing index rebuilds");
    assert_eq!(rebuilt.indexed_notes, 1);
    assert_eq!(index.search("beta", 10).expect("rebuilt query").len(), 1);
}

#[test]
fn single_file_updates_and_removals_converge_to_the_current_disk_state() {
    let (_temp, vault) = marked_vault();
    vault
        .create_note("Live.md", "# Live\n\nfirst\n")
        .expect("live note");
    let index = SearchIndex::open(vault.clone()).expect("search index");
    index.rebuild().expect("initial rebuild");

    fs::write(vault.root().join("Live.md"), "# Live\n\nsecond\n").expect("external edit");
    index
        .update_path("Live.md", "modified")
        .expect("incremental update");
    assert!(index.search("first", 10).expect("old query").is_empty());
    assert_eq!(index.search("second", 10).expect("new query").len(), 1);

    fs::remove_file(vault.root().join("Live.md")).expect("external removal");
    index
        .update_path("Live.md", "removed")
        .expect("incremental removal");
    assert!(index
        .search("second", 10)
        .expect("removed query")
        .is_empty());
}

#[test]
fn ten_thousand_notes_rebuild_into_a_queryable_disposable_index() {
    let (_temp, vault) = marked_vault();
    fs::create_dir(vault.root().join("Bulk")).expect("bulk folder");
    for number in 0..10_000 {
        fs::write(
            vault
                .root()
                .join("Bulk")
                .join(format!("Note-{number:05}.md")),
            format!("# Synthetic {number}\n\nneedle-{number:05} #bulk\n"),
        )
        .expect("bulk note");
    }

    let index = SearchIndex::open(vault).expect("search index");
    let started = Instant::now();
    let summary = index.rebuild().expect("10k rebuild");
    assert_eq!(summary.indexed_notes, 10_000);
    assert_eq!(
        index.search("needle-09999", 10).expect("10k query").len(),
        1
    );
    assert!(
        started.elapsed().as_secs() < 60,
        "synthetic 10k indexing exceeded the generous safety ceiling"
    );
}
