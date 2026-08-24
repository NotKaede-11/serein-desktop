use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;

use crate::vault::{
    VaultEngine, HUSHNOTE_INTERNAL_DIR, HUSHNOTE_SYNTHETIC_VAULT_MARKER, INTERNAL_DIR,
    LEGACY_INTERNAL_DIR, LEGACY_SYNTHETIC_VAULT_MARKER, SYNTHETIC_VAULT_MARKER,
};

const SELF_WRITE_WINDOW: Duration = Duration::from_secs(5);
type JournalEntries = HashMap<PathBuf, (Option<String>, Instant)>;

#[derive(Clone, Default)]
pub struct WriteJournal(Arc<Mutex<JournalEntries>>);

impl WriteJournal {
    pub fn record(&self, path: PathBuf, revision: String) {
        if let Ok(mut entries) = self.0.lock() {
            entries.retain(|_, (_, recorded)| recorded.elapsed() <= SELF_WRITE_WINDOW);
            entries.insert(path, (Some(revision), Instant::now()));
        }
    }

    pub fn record_any(&self, path: PathBuf) {
        if let Ok(mut entries) = self.0.lock() {
            entries.retain(|_, (_, recorded)| recorded.elapsed() <= SELF_WRITE_WINDOW);
            entries.insert(path, (None, Instant::now()));
        }
    }

    pub fn clear(&self, path: &Path) {
        if let Ok(mut entries) = self.0.lock() {
            entries.remove(path);
        }
    }

    fn classify(&self, path: &Path, revision: Option<&str>) -> ChangeOrigin {
        let Ok(mut entries) = self.0.lock() else {
            return ChangeOrigin::External;
        };
        entries.retain(|_, (_, recorded)| recorded.elapsed() <= SELF_WRITE_WINDOW);
        let is_self = entries.get(path).is_some_and(|(expected, _)| {
            expected
                .as_deref()
                .is_none_or(|expected| revision.is_some_and(|actual| actual == expected))
        });
        if is_self {
            entries.remove(path);
            ChangeOrigin::Serein
        } else {
            ChangeOrigin::External
        }
    }
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ChangeOrigin {
    Serein,
    External,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct VaultChange {
    pub relative_path: String,
    pub kind: String,
    pub origin: ChangeOrigin,
}

pub struct VaultWatcher {
    _watcher: RecommendedWatcher,
}

impl VaultWatcher {
    pub fn start(
        vault: VaultEngine,
        journal: WriteJournal,
        on_change: impl Fn(VaultChange) + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let root = vault.root().to_path_buf();
        let vault_for_events = vault.clone();
        let callback = Arc::new(on_change);
        let mut watcher = notify::recommended_watcher(move |result: notify::Result<Event>| {
            let Ok(event) = result else {
                return;
            };
            for path in event.paths {
                let Ok(relative) = path.strip_prefix(&root) else {
                    continue;
                };
                let portable = relative.to_string_lossy().replace('\\', "/");
                if should_ignore_path(&portable) {
                    continue;
                }
                let Some(kind) = event_kind(&event.kind) else {
                    continue;
                };
                let revision = vault_for_events
                    .read_note(&portable)
                    .ok()
                    .map(|note| note.revision);
                callback(VaultChange {
                    relative_path: portable,
                    kind: kind.to_owned(),
                    origin: journal.classify(&path, revision.as_deref()),
                });
            }
        })
        .map_err(|error| error.to_string())?;
        watcher
            .watch(vault.root(), RecursiveMode::Recursive)
            .map_err(|error| error.to_string())?;
        Ok(Self { _watcher: watcher })
    }
}

fn should_ignore_path(portable: &str) -> bool {
    portable.is_empty()
        || portable.starts_with(&format!("{INTERNAL_DIR}/"))
        || portable == INTERNAL_DIR
        || portable.starts_with(&format!("{LEGACY_INTERNAL_DIR}/"))
        || portable == LEGACY_INTERNAL_DIR
        || portable.starts_with(&format!("{HUSHNOTE_INTERNAL_DIR}/"))
        || portable == HUSHNOTE_INTERNAL_DIR
        || portable == SYNTHETIC_VAULT_MARKER
        || portable == HUSHNOTE_SYNTHETIC_VAULT_MARKER
        || portable == LEGACY_SYNTHETIC_VAULT_MARKER
        || portable.contains(".serein-tmp-")
        || portable.contains(".hushnote-tmp-")
        || portable.contains(".writ-tmp-")
}

fn event_kind(kind: &EventKind) -> Option<&'static str> {
    match kind {
        EventKind::Create(_) => Some("created"),
        EventKind::Modify(_) => Some("modified"),
        EventKind::Remove(_) => Some("removed"),
        EventKind::Access(_) => None,
        EventKind::Other | EventKind::Any => Some("other"),
    }
}

#[cfg(test)]
mod tests {
    use super::{should_ignore_path, ChangeOrigin, WriteJournal};
    use std::path::PathBuf;

    #[test]
    fn path_only_journal_entries_classify_explorer_mutations_as_serein() {
        let journal = WriteJournal::default();
        let path = PathBuf::from(r"C:\synthetic\Notes\Created.md");
        journal.record_any(path.clone());

        assert_eq!(journal.classify(&path, None), ChangeOrigin::Serein);
    }

    #[test]
    fn attachment_files_are_watched_but_internal_files_are_not() {
        assert!(!should_ignore_path("Attachments/image.png"));
        assert!(!should_ignore_path("Attachments/lecture.pdf"));
        assert!(should_ignore_path(".serein/index.db"));
        assert!(should_ignore_path(".serein-synthetic-vault"));
        assert!(should_ignore_path("Attachments/.image.png.serein-tmp-1-2"));
        assert!(should_ignore_path(".hushnote/index.db"));
        assert!(should_ignore_path(".hushnote-synthetic-vault"));
        assert!(should_ignore_path(
            "Attachments/.image.png.hushnote-tmp-1-2"
        ));
        assert!(should_ignore_path(".writ/index.db"));
        assert!(should_ignore_path(".writ-synthetic-vault"));
        assert!(should_ignore_path("Attachments/.image.png.writ-tmp-1-2"));
    }
}
