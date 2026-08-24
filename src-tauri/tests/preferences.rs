use std::fs;

use serde_json::json;
use serein_lib::preferences::{load_with_legacy_candidates, JsonStore};
use tempfile::tempdir;

#[test]
fn valid_hushnote_application_settings_copy_into_serein_without_deleting_the_source() {
    let temp = tempdir().expect("tempdir");
    let current = temp.path().join("io.serein.desktop/settings.json");
    let hushnote = temp.path().join("io.hushnote.desktop/settings.json");
    let writ = temp.path().join("io.writ.desktop/settings.json");
    JsonStore::new(hushnote.clone())
        .save(&json!({"version": 2, "appearance": {"theme": "light"}}))
        .expect("legacy settings");

    let migrated = load_with_legacy_candidates(current.clone(), [hushnote.clone(), writ])
        .expect("settings migration");

    assert_eq!(migrated.value.unwrap()["appearance"]["theme"], "light");
    assert_eq!(
        JsonStore::new(current)
            .load()
            .expect("current settings")
            .value
            .unwrap()["appearance"]["theme"],
        "light"
    );
    assert!(
        hushnote.is_file(),
        "the Hushnote source remains available after a verified copy"
    );
}

#[test]
fn writ_settings_remain_a_supported_fallback_when_hushnote_settings_are_absent() {
    let temp = tempdir().expect("tempdir");
    let current = temp.path().join("io.serein.desktop/settings.json");
    let hushnote = temp.path().join("io.hushnote.desktop/settings.json");
    let writ = temp.path().join("io.writ.desktop/settings.json");
    JsonStore::new(writ.clone())
        .save(&json!({"version": 2, "appearance": {"theme": "system"}}))
        .expect("Writ.io settings");

    let migrated = load_with_legacy_candidates(current.clone(), [hushnote, writ.clone()])
        .expect("settings migration");

    assert_eq!(migrated.value.unwrap()["appearance"]["theme"], "system");
    assert!(current.is_file());
    assert!(writ.is_file());
}

#[test]
fn malformed_hushnote_settings_are_not_replaced_by_older_writ_settings() {
    let temp = tempdir().expect("tempdir");
    let current = temp.path().join("io.serein.desktop/settings.json");
    let hushnote = temp.path().join("io.hushnote.desktop/settings.json");
    let writ = temp.path().join("io.writ.desktop/settings.json");
    fs::create_dir_all(hushnote.parent().expect("legacy parent")).expect("legacy parent");
    fs::write(&hushnote, "{ partial").expect("malformed legacy settings");
    JsonStore::new(writ.clone())
        .save(&json!({"version": 2, "appearance": {"theme": "light"}}))
        .expect("older settings");

    let loaded = load_with_legacy_candidates(current.clone(), [hushnote.clone(), writ])
        .expect("safe migration fallback");

    assert!(loaded.value.is_none());
    assert!(loaded.warning.is_some());
    assert!(!current.exists());
    assert!(hushnote.is_file());
}

#[test]
fn settings_round_trip_atomically_and_survive_restart() {
    let temp = tempdir().expect("tempdir");
    let path = temp.path().join("settings.json");
    let store = JsonStore::new(path.clone());

    store
        .save(&json!({"version": 2, "appearance": {"theme": "light"}}))
        .expect("save settings");
    let reopened = JsonStore::new(path).load().expect("load settings");

    assert_eq!(reopened.value.unwrap()["appearance"]["theme"], "light");
    assert!(reopened.warning.is_none());
}

#[test]
fn malformed_settings_fall_back_without_blocking_startup() {
    let temp = tempdir().expect("tempdir");
    let path = temp.path().join("settings.json");
    fs::write(&path, "{ definitely not json").expect("write malformed settings");

    let loaded = JsonStore::new(path)
        .load()
        .expect("malformed settings are recoverable");

    assert!(loaded.value.is_none());
    assert!(loaded.warning.unwrap().contains("could not be read"));
}

#[test]
fn interrupted_temporary_file_never_replaces_the_last_good_document() {
    let temp = tempdir().expect("tempdir");
    let path = temp.path().join("session.json");
    let store = JsonStore::new(path.clone());
    store
        .save(&json!({"version": 1, "tabs": ["Welcome.md"]}))
        .expect("save session");
    fs::write(path.with_extension("json.tmp"), "partial").expect("write interrupted temp file");

    let loaded = JsonStore::new(path).load().expect("load last good session");

    assert_eq!(loaded.value.unwrap()["tabs"][0], "Welcome.md");
}

#[test]
fn different_vaults_keep_independent_workspace_sessions() {
    let temp = tempdir().expect("tempdir");
    let first = JsonStore::new(temp.path().join("vault-a/.serein/workspace-session.json"));
    let second = JsonStore::new(temp.path().join("vault-b/.serein/workspace-session.json"));

    first
        .save(&json!({"version": 1, "layout": "quiet-focus"}))
        .expect("save first vault");
    second
        .save(&json!({"version": 1, "layout": "balanced-vault"}))
        .expect("save second vault");

    assert_eq!(
        first.load().expect("load first").value.unwrap()["layout"],
        "quiet-focus"
    );
    assert_eq!(
        second.load().expect("load second").value.unwrap()["layout"],
        "balanced-vault"
    );
}
