//! In-app management of the OpenCode Go API key. UsagePal stores only keys entered in its own
//! Settings dialog and does not modify OpenCode's auth file.

use std::path::PathBuf;
use std::{fs::OpenOptions, io::Write};

use serde::Serialize;
use specta::Type;

const CONFIG_RELATIVE_PATH: &str = ".config/usagepal/opencode-go.json";
const AUTH_RELATIVE_PATH: &str = ".local/share/opencode/auth.json";
const ENV_NAME: &str = "OPENCODE_API_KEY";

fn home_path(relative: &str) -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(relative))
}

fn key_from_value(value: &serde_json::Value) -> Option<String> {
    for field in ["apiKey", "api_key", "key"] {
        if let Some(found) = value.get(field).and_then(|item| item.as_str()) {
            let trimmed = found.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        }
    }
    None
}

fn file_has_key(relative: &str, entry: Option<&str>) -> bool {
    let Some(path) = home_path(relative) else {
        return false;
    };
    let Some(value) = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| serde_json::from_str::<serde_json::Value>(&text).ok())
    else {
        return false;
    };
    let candidate = match entry {
        Some(name) => value.get(name),
        None => Some(&value),
    };
    candidate.and_then(key_from_value).is_some()
}

fn write_private_file(path: &std::path::Path, contents: &str) -> Result<(), std::io::Error> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }

    let mut file = options.open(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    file.write_all(contents.as_bytes())
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenCodeGoKeyStatus {
    pub saved: bool,
    pub from_open_code: bool,
    pub from_env: bool,
}

#[tauri::command]
#[specta::specta]
pub fn opencode_go_key_status() -> OpenCodeGoKeyStatus {
    OpenCodeGoKeyStatus {
        saved: file_has_key(CONFIG_RELATIVE_PATH, None),
        from_open_code: file_has_key(AUTH_RELATIVE_PATH, Some("opencode-go")),
        from_env: std::env::var(ENV_NAME)
            .ok()
            .is_some_and(|value| !value.trim().is_empty()),
    }
}

#[tauri::command]
#[specta::specta]
pub fn save_opencode_go_key(key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("API key is empty.".to_string());
    }
    let path = home_path(CONFIG_RELATIVE_PATH).ok_or("No home directory available.")?;
    if let Some(directory) = path.parent() {
        std::fs::create_dir_all(directory)
            .map_err(|error| format!("Couldn't create the config directory: {error}"))?;
    }
    write_private_file(&path, &serde_json::json!({ "apiKey": trimmed }).to_string())
        .map_err(|error| format!("Couldn't save the API key: {error}"))
}

#[tauri::command]
#[specta::specta]
pub fn clear_opencode_go_key() -> Result<(), String> {
    let path = home_path(CONFIG_RELATIVE_PATH).ok_or("No home directory available.")?;
    if path.exists() {
        std::fs::remove_file(path)
            .map_err(|error| format!("Couldn't remove the API key: {error}"))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_supported_key_fields() {
        for value in [
            serde_json::json!({ "apiKey": "one" }),
            serde_json::json!({ "api_key": "two" }),
            serde_json::json!({ "key": "three" }),
        ] {
            assert!(key_from_value(&value).is_some());
        }
    }

    #[cfg(unix)]
    #[test]
    fn saved_key_file_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;

        let path = std::env::temp_dir().join(format!(
            "usagepal-opencode-go-key-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        write_private_file(&path, "secret").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        let _ = std::fs::remove_file(path);
        assert_eq!(mode, 0o600);
    }
}
