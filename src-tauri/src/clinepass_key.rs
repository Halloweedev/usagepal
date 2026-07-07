//! In-app management of the ClinePass API key. ClinePass can read the Cline app's own OAuth config,
//! a UsagePal-managed API key, or `CLINE_API_KEY`. This module writes / clears only the
//! UsagePal-managed plaintext config file (`~/.config/usagepal/cline-pass.json`, JSON
//! `{"apiKey":"..."}`).

use std::path::PathBuf;

use serde::Serialize;
use specta::Type;

const CONFIG_RELATIVE_PATHS: [&str; 1] = [".config/usagepal/cline-pass.json"];
const ENV_NAMES: [&str; 1] = ["CLINE_API_KEY"];

fn config_paths() -> Vec<PathBuf> {
    match dirs::home_dir() {
        Some(home) => CONFIG_RELATIVE_PATHS.iter().map(|rel| home.join(rel)).collect(),
        None => Vec::new(),
    }
}

fn primary_path() -> Option<PathBuf> {
    config_paths().into_iter().next()
}

fn key_from_text(text: &str) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with('{') {
        let value: serde_json::Value = serde_json::from_str(trimmed).ok()?;
        for field in ["apiKey", "api_key", "key"] {
            if let Some(found) = value.get(field).and_then(|v| v.as_str()) {
                let found = found.trim();
                if !found.is_empty() {
                    return Some(found.to_string());
                }
            }
        }
        return None;
    }
    Some(trimmed.to_string())
}

fn file_has_key() -> bool {
    config_paths()
        .iter()
        .any(|path| std::fs::read_to_string(path).ok().and_then(|t| key_from_text(&t)).is_some())
}

fn env_has_key() -> bool {
    ENV_NAMES
        .iter()
        .any(|name| std::env::var(name).ok().map(|v| !v.trim().is_empty()).unwrap_or(false))
}

#[derive(Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClinePassKeyStatus {
    pub saved: bool,
    pub from_env: bool,
}

#[tauri::command]
#[specta::specta]
pub fn clinepass_key_status() -> ClinePassKeyStatus {
    ClinePassKeyStatus { saved: file_has_key(), from_env: env_has_key() }
}

#[tauri::command]
#[specta::specta]
pub fn save_clinepass_key(key: String) -> Result<(), String> {
    let trimmed = key.trim();
    if trimmed.is_empty() {
        return Err("API key is empty.".to_string());
    }
    let path = primary_path().ok_or("No home directory available.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("Couldn't create the config directory: {e}"))?;
    }
    let body = serde_json::json!({ "apiKey": trimmed }).to_string();
    std::fs::write(&path, body).map_err(|e| format!("Couldn't save the API key: {e}"))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn clear_clinepass_key() -> Result<(), String> {
    for path in config_paths() {
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| format!("Couldn't remove the API key: {e}"))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_from_json_object() {
        assert_eq!(key_from_text(r#"{"apiKey":"cline-1"}"#).as_deref(), Some("cline-1"));
        assert_eq!(key_from_text(r#"{"api_key":" cline-2 "}"#).as_deref(), Some("cline-2"));
        assert_eq!(key_from_text(r#"{"key":"cline-3"}"#).as_deref(), Some("cline-3"));
    }

    #[test]
    fn key_from_plain_text() {
        assert_eq!(key_from_text("  cline-plain\n").as_deref(), Some("cline-plain"));
    }

    #[test]
    fn no_key_from_empty_or_bad_json() {
        assert_eq!(key_from_text("   "), None);
        assert_eq!(key_from_text(r#"{"nope":"x"}"#), None);
    }
}
