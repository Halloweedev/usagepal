//! In-app management of the OpenRouter API key. OpenRouter has no companion CLI that leaves a
//! credential on disk, so the user supplies one. The Settings → API Keys card calls these commands to
//! write / clear the plaintext config file the `openrouter` plugin already reads
//! (`~/.config/usagepal/openrouter.json`, JSON `{"apiKey": "..."}`).
//!
//! The saved key is never read back into the webview — `key_status` returns only booleans — so the
//! secret leaves the disk only for the outbound provider request the plugin makes.

use std::path::PathBuf;

use serde::Serialize;

/// Config files the plugin reads, in the same order. The first is the one this card writes.
const CONFIG_RELATIVE_PATHS: [&str; 2] = [".config/usagepal/openrouter.json", ".config/openrouter/key.json"];
/// Environment variables the plugin falls back to, surfaced as the "from environment" indicator.
const ENV_NAMES: [&str; 2] = ["OPENROUTER_API_KEY", "OPENROUTER_KEY"];

fn config_paths() -> Vec<PathBuf> {
    match dirs::home_dir() {
        Some(home) => CONFIG_RELATIVE_PATHS.iter().map(|rel| home.join(rel)).collect(),
        None => Vec::new(),
    }
}

/// The primary path this card writes to (the first path the plugin checks).
fn primary_path() -> Option<PathBuf> {
    config_paths().into_iter().next()
}

/// Extract a key from a config file: JSON `apiKey`/`api_key`/`key`, or a plain-text key file.
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

/// Which sources currently hold a key — drives the API Keys card state without exposing the key.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyStatus {
    /// A key is saved in a config file.
    pub saved: bool,
    /// A key is present in the environment (a saved key takes precedence — the plugin checks files first).
    pub from_env: bool,
}

#[tauri::command]
pub fn openrouter_key_status() -> KeyStatus {
    KeyStatus { saved: file_has_key(), from_env: env_has_key() }
}

#[tauri::command]
pub fn save_openrouter_key(key: String) -> Result<(), String> {
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
pub fn clear_openrouter_key() -> Result<(), String> {
    // Remove from every path the plugin reads, so a key in the alternate file doesn't resurface.
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
        assert_eq!(key_from_text(r#"{"apiKey":"sk-or-1"}"#).as_deref(), Some("sk-or-1"));
        assert_eq!(key_from_text(r#"{"api_key":" sk-or-2 "}"#).as_deref(), Some("sk-or-2"));
        assert_eq!(key_from_text(r#"{"key":"sk-or-3"}"#).as_deref(), Some("sk-or-3"));
    }

    #[test]
    fn key_from_plain_text() {
        assert_eq!(key_from_text("  sk-or-plain\n").as_deref(), Some("sk-or-plain"));
    }

    #[test]
    fn no_key_from_empty_or_bad_json() {
        assert_eq!(key_from_text("   "), None);
        assert_eq!(key_from_text(r#"{"nope":"x"}"#), None);
    }
}
