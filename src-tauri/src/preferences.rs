use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use serde::Serialize;
use serde_json::Value;

use crate::vault::atomic_replace;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonLoad {
    pub value: Option<Value>,
    pub warning: Option<String>,
}

#[derive(Debug, Clone)]
pub struct JsonStore {
    path: PathBuf,
}

impl JsonStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn load(&self) -> Result<JsonLoad, String> {
        let content = match fs::read_to_string(&self.path) {
            Ok(content) => content,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(JsonLoad {
                    value: None,
                    warning: None,
                });
            }
            Err(error) => return Err(format!("Settings could not be opened: {error}")),
        };
        match serde_json::from_str(&content) {
            Ok(value) => Ok(JsonLoad {
                value: Some(value),
                warning: None,
            }),
            Err(_) => Ok(JsonLoad {
                value: None,
                warning: Some(
                    "Settings could not be read. Serein started with safe defaults.".to_owned(),
                ),
            }),
        }
    }

    pub fn save(&self, value: &Value) -> Result<(), String> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| "Settings path has no parent directory.".to_owned())?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let temp = temporary_path(&self.path);
        let bytes = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
        let mut file = OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&temp)
            .map_err(|error| error.to_string())?;
        file.write_all(&bytes).map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        atomic_replace(&temp, &self.path).map_err(|error| error.to_string())
    }
}

pub fn load_with_legacy(current: PathBuf, legacy: PathBuf) -> Result<JsonLoad, String> {
    load_with_legacy_candidates(current, [legacy])
}

pub fn load_with_legacy_candidates(
    current: PathBuf,
    legacy_candidates: impl IntoIterator<Item = PathBuf>,
) -> Result<JsonLoad, String> {
    let current_store = JsonStore::new(current.clone());
    let current_load = current_store.load()?;
    if current.exists() || current_load.value.is_some() || current_load.warning.is_some() {
        return Ok(current_load);
    }

    for legacy in legacy_candidates {
        let legacy_store = JsonStore::new(legacy.clone());
        let legacy_load = legacy_store.load()?;
        if legacy.exists() || legacy_load.value.is_some() || legacy_load.warning.is_some() {
            if let Some(value) = legacy_load.value.as_ref() {
                current_store.save(value)?;
            }
            return Ok(legacy_load);
        }
    }
    Ok(current_load)
}

fn temporary_path(path: &Path) -> PathBuf {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| format!("{value}.tmp"))
        .unwrap_or_else(|| "tmp".to_owned());
    path.with_extension(extension)
}
