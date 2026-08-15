//! Account registry: reads per-provider account metadata from settings.json and
//! resolves each account's stored secret into the per-probe env overrides used by
//! the plugin sandbox. Secrets are owned by UsagePal (0o600 files / managed dirs),
//! never the CLI's own stores.

use crate::plugin_engine::account::{AccountRegistry, AccountSpec};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};

/// Account metadata as persisted by the frontend under settings.json "accounts".
#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AccountMeta {
    pub account_id: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub order: i64,
}

/// Isolated reader struct — a bad `accounts` field can't disturb other settings.
#[derive(serde::Deserialize)]
struct AccountsSettingsFile {
    accounts: Option<HashMap<String, Vec<AccountMeta>>>,
}

pub(crate) fn read_settings_accounts(app_data_dir: &Path) -> HashMap<String, Vec<AccountMeta>> {
    let path = app_data_dir.join("settings.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    let Ok(parsed) = serde_json::from_str::<AccountsSettingsFile>(&text) else {
        return HashMap::new();
    };
    parsed.accounts.unwrap_or_default()
}

fn config_accounts_dir(provider_id: &str) -> Option<PathBuf> {
    dirs::home_dir().map(|home| home.join(".config/usagepal/accounts").join(provider_id))
}

fn claude_secret_path(account_id: &str) -> Option<PathBuf> {
    config_accounts_dir("claude").map(|d| d.join(format!("{account_id}.json")))
}

fn cursor_secret_path(account_id: &str) -> Option<PathBuf> {
    config_accounts_dir("cursor").map(|d| d.join(format!("{account_id}.json")))
}

pub(crate) fn codex_profile_dir(app_data_dir: &Path, account_id: &str) -> PathBuf {
    app_data_dir.join("accounts").join("codex").join(account_id)
}

/// Owner-only (0o600) secret writer — identical to opencode_go_key.rs.
pub(crate) fn write_private_file(path: &Path, contents: &str) -> Result<(), std::io::Error> {
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

fn read_json_string_field(path: &Path, field: &str) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value.get(field)?.as_str().map(str::to_string)
}

/// Resolve one account's stored secret into env overrides. `None` → skip it.
fn resolve_env_overrides(
    provider_id: &str,
    account_id: &str,
    app_data_dir: &Path,
) -> Option<HashMap<String, String>> {
    let mut env = HashMap::new();
    match provider_id {
        "claude" => {
            let token = read_json_string_field(&claude_secret_path(account_id)?, "setupToken")?;
            env.insert("CLAUDE_CODE_OAUTH_TOKEN".to_string(), token);
        }
        "codex" => {
            let dir = codex_profile_dir(app_data_dir, account_id);
            if !dir.join("auth.json").exists() {
                return None;
            }
            env.insert("CODEX_HOME".to_string(), dir.to_string_lossy().to_string());
        }
        "cursor" => {
            let path = cursor_secret_path(account_id)?;
            if !path.exists() {
                return None;
            }
            env.insert(
                "USAGEPAL_CURSOR_AUTH_FILE".to_string(),
                path.to_string_lossy().to_string(),
            );
        }
        _ => return None,
    }
    Some(env)
}

pub fn load_account_registry(app_data_dir: &Path) -> AccountRegistry {
    let mut registry: HashMap<String, Vec<AccountSpec>> = HashMap::new();
    let mut metas = read_settings_accounts(app_data_dir);

    for (provider_id, mut accounts) in metas.drain() {
        accounts.sort_by_key(|a| a.order);
        for meta in accounts {
            match resolve_env_overrides(&provider_id, &meta.account_id, app_data_dir) {
                Some(env_overrides) => registry
                    .entry(provider_id.clone())
                    .or_default()
                    .push(AccountSpec {
                        account_id: meta.account_id,
                        env_overrides,
                    }),
                None => log::warn!(
                    "skipping {} account {}: secret not resolvable",
                    provider_id,
                    meta.account_id
                ),
            }
        }
    }
    AccountRegistry(registry)
}

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct AccountAdded {
    pub account_id: String,
}

#[tauri::command]
#[specta::specta]
pub fn save_claude_account(label: String, setup_token: String) -> Result<AccountAdded, String> {
    let token = setup_token.trim();
    if token.is_empty() {
        return Err("Setup token is empty.".to_string());
    }
    let _ = label; // label is persisted by the frontend in settings.json
    let account_id = uuid::Uuid::new_v4().to_string();
    let path = claude_secret_path(&account_id).ok_or("No home directory available.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Couldn't create the accounts directory: {e}"))?;
    }
    write_private_file(&path, &serde_json::json!({ "setupToken": token }).to_string())
        .map_err(|e| format!("Couldn't save the account: {e}"))?;
    Ok(AccountAdded { account_id })
}

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};

/// Extract the `sub` claim from a JWT's payload. No signature verification — this
/// is only reading Cursor's own token to key the account by its stable subject.
fn decode_jwt_sub(access_token: &str) -> Option<String> {
    let payload_b64 = access_token.split('.').nth(1)?;
    let bytes = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
    value.get("sub")?.as_str().map(str::to_string)
}

#[tauri::command]
#[specta::specta]
pub fn snapshot_cursor_account(label: String) -> Result<AccountAdded, String> {
    let _ = label; // persisted by the frontend
    let (access_token, refresh_token) = read_cursor_state_tokens()
        .ok_or("Couldn't read the Cursor login. Sign in to the Cursor app first.")?;
    let account_id = decode_jwt_sub(&access_token).ok_or("Cursor token was not a readable JWT.")?;
    let path = cursor_secret_path(&account_id).ok_or("No home directory available.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Couldn't create the accounts directory: {e}"))?;
    }
    let body = serde_json::json!({
        "accessToken": access_token,
        "refreshToken": refresh_token,
    })
    .to_string();
    write_private_file(&path, &body).map_err(|e| format!("Couldn't save the account: {e}"))?;
    Ok(AccountAdded { account_id })
}

/// Read Cursor's access/refresh tokens READ-ONLY from its state.vscdb via `sqlite3`.
/// Mirrors the shell-out pattern host_api.rs uses for sqlite; never writes.
fn read_cursor_state_tokens() -> Option<(String, String)> {
    let db = dirs::home_dir()?
        .join("Library/Application Support/Cursor/User/globalStorage/state.vscdb");
    let read = |key: &str| -> Option<String> {
        let out = std::process::Command::new("sqlite3")
            .arg("-readonly")
            .arg(&db)
            .arg(format!("SELECT value FROM ItemTable WHERE key = '{key}' LIMIT 1;"))
            .output()
            .ok()?;
        if !out.status.success() {
            return None;
        }
        let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if s.is_empty() {
            None
        } else {
            Some(s)
        }
    };
    let access = read("cursorAuth/accessToken")?;
    let refresh = read("cursorAuth/refreshToken").unwrap_or_default();
    Some((access, refresh))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn tmp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "usagepal-accounts-test-{}-{}-{}",
            label,
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn parses_account_metadata_from_settings_json() {
        let app_data = tmp_dir("meta");
        fs::write(
            app_data.join("settings.json"),
            r#"{"accounts":{"claude":[{"accountId":"a1","label":"Work","order":0}]}}"#,
        )
        .unwrap();
        let metas = read_settings_accounts(&app_data);
        assert_eq!(metas.get("claude").unwrap().len(), 1);
        assert_eq!(metas["claude"][0].account_id, "a1");
        assert_eq!(metas["claude"][0].label, "Work");
    }

    #[test]
    fn missing_settings_yields_empty_metadata() {
        let app_data = tmp_dir("empty");
        assert!(read_settings_accounts(&app_data).is_empty());
    }

    #[test]
    fn codex_account_resolves_to_codex_home_override() {
        let app_data = tmp_dir("codex");
        // A profile dir that exists → CODEX_HOME override is produced.
        let profile = codex_profile_dir(&app_data, "c1");
        fs::create_dir_all(&profile).unwrap();
        fs::write(profile.join("auth.json"), "{}").unwrap();
        fs::write(
            app_data.join("settings.json"),
            r#"{"accounts":{"codex":[{"accountId":"c1","label":"Home","order":0}]}}"#,
        )
        .unwrap();
        let registry = load_account_registry(&app_data);
        let specs = registry.0.get("codex").expect("codex accounts present");
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].account_id, "c1");
        assert_eq!(
            specs[0].env_overrides.get("CODEX_HOME").map(String::as_str),
            Some(profile.to_string_lossy().as_ref())
        );
    }

    #[test]
    fn claude_secret_roundtrips_setup_token() {
        let dir = tmp_dir("claude-secret");
        let path = dir.join("acc.json");
        write_private_file(
            &path,
            &serde_json::json!({ "setupToken": "sk-ant-oat01-XXX" }).to_string(),
        )
        .unwrap();
        assert_eq!(
            read_json_string_field(&path, "setupToken").as_deref(),
            Some("sk-ant-oat01-XXX")
        );
    }

    #[test]
    fn decode_jwt_sub_extracts_subject() {
        use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"HS256","typ":"JWT"}"#);
        let payload = URL_SAFE_NO_PAD.encode(br#"{"sub":"auth0|user_01ABC","exp":9999999999}"#);
        let jwt = format!("{header}.{payload}.sig");
        assert_eq!(decode_jwt_sub(&jwt), Some("auth0|user_01ABC".to_string()));
    }

    #[test]
    fn decode_jwt_sub_rejects_malformed_token() {
        assert_eq!(decode_jwt_sub("not-a-jwt"), None);
        assert_eq!(decode_jwt_sub(""), None);
    }

    #[test]
    fn codex_account_with_missing_profile_is_skipped() {
        let app_data = tmp_dir("codex-missing");
        fs::write(
            app_data.join("settings.json"),
            r#"{"accounts":{"codex":[{"accountId":"gone","label":"X","order":0}]}}"#,
        )
        .unwrap();
        let registry = load_account_registry(&app_data);
        // No resolvable secret → provider absent (or empty), never a panic.
        assert!(registry.0.get("codex").map_or(true, |v| v.is_empty()));
    }
}
