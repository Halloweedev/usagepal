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
