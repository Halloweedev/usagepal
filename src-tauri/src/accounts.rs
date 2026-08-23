//! Account registry: reads per-provider account metadata from settings.json and
//! resolves each account's stored secret into the per-probe env overrides used by
//! the plugin sandbox. Secrets are owned by UsagePal (0o600 files / managed dirs),
//! never the CLI's own stores.

use crate::plugin_engine::account::{AccountRegistry, AccountSpec};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::Emitter;

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

pub(crate) fn parse_settings_accounts(text: &str) -> HashMap<String, Vec<AccountMeta>> {
    let Ok(parsed) = serde_json::from_str::<AccountsSettingsFile>(text) else {
        return HashMap::new();
    };
    parsed.accounts.unwrap_or_default()
}

pub(crate) fn read_settings_accounts(app_data_dir: &Path) -> HashMap<String, Vec<AccountMeta>> {
    let path = app_data_dir.join("settings.json");
    let Ok(text) = std::fs::read_to_string(path) else {
        return HashMap::new();
    };
    parse_settings_accounts(&text)
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

fn opencode_go_secret_path(account_id: &str) -> Option<PathBuf> {
    config_accounts_dir("opencode-go").map(|d| d.join(format!("{account_id}.json")))
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
            let secret_path = claude_secret_path(account_id)?;
            let token = read_json_string_field(&secret_path, "setupToken")?;
            // The account that is the current local Claude login probes like the
            // default (local credentials → full live usage + real local spend).
            // Others use the inference-only setup token and are flagged as having
            // no local logs, so they never show the default login's spend.
            let stored_identity = read_json_string_field(&secret_path, "localIdentity");
            for (k, v) in
                claude_account_env(&token, stored_identity.as_deref(), claude_local_identity().as_deref())
            {
                env.insert(k, v);
            }
        }
        "codex" => {
            let dir = codex_profile_dir(app_data_dir, account_id);
            if !dir.join("auth.json").exists() {
                return None;
            }
            // Auth/API probe reads the managed profile.
            env.insert("CODEX_HOME".to_string(), dir.to_string_lossy().to_string());
            // Spend (ccusage) reads the *real* local home, but only for the
            // account that is the current local CLI login — its session logs live
            // there, not in the managed profile. Others get no local logs.
            let real_home = codex_real_home();
            let real_home_id = codex_real_home_account_id(real_home.as_deref());
            for (k, v) in codex_spend_env(account_id, real_home.as_deref(), real_home_id.as_deref()) {
                env.insert(k, v);
            }
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
        "opencode-go" => {
            let path = opencode_go_secret_path(account_id)?;
            let api_key = read_json_string_field(&path, "apiKey")?;
            // A per-account key wins over the shared Settings key / OpenCode
            // auth / ambient OPENCODE_API_KEY so each card reports its own usage.
            env.insert(
                "USAGEPAL_OPENCODE_GO_API_KEY".to_string(),
                api_key.clone(),
            );
            // Local spend (opencode.db) is machine-wide, so only the account
            // whose key matches the local CLI login may read it; others get the
            // no-local-logs flag and render "—" rows.
            for (k, v) in opencode_go_spend_env(&api_key, opencode_go_local_login_key().as_deref()) {
                env.insert(k, v);
            }
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
    // Snapshot the current local Claude login so this account can later be
    // recognised as the local login and show its real `~/.claude` spend. Opaque
    // setup-tokens carry no identity, so add-time capture is the only signal.
    let secret = match claude_local_identity() {
        Some(identity) => serde_json::json!({ "setupToken": token, "localIdentity": identity }),
        None => serde_json::json!({ "setupToken": token }),
    };
    write_private_file(&path, &secret.to_string())
        .map_err(|e| format!("Couldn't save the account: {e}"))?;
    Ok(AccountAdded { account_id })
}

#[tauri::command]
#[specta::specta]
pub fn save_opencode_go_account(label: String, api_key: String) -> Result<AccountAdded, String> {
    let key = api_key.trim();
    if key.is_empty() {
        return Err("API key is empty.".to_string());
    }
    let _ = label; // label is persisted by the frontend in settings.json
    let account_id = uuid::Uuid::new_v4().to_string();
    let path = opencode_go_secret_path(&account_id).ok_or("No home directory available.")?;
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Couldn't create the accounts directory: {e}"))?;
    }
    write_private_file(&path, &serde_json::json!({ "apiKey": key }).to_string())
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

#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct CodexLoginStarted {
    pub staging_id: String,
}

fn extract_codex_account_id(auth_json_text: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(auth_json_text).ok()?;
    value
        .get("tokens")?
        .get("account_id")?
        .as_str()
        .map(str::to_string)
}

/// The user's real Codex home (where the CLI writes session logs): `$CODEX_HOME`
/// if the app inherited one, else `~/.codex`. Distinct from a per-account managed
/// profile dir under the app-data folder.
fn codex_real_home() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var("CODEX_HOME") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return Some(PathBuf::from(trimmed));
        }
    }
    dirs::home_dir().map(|home| home.join(".codex"))
}

/// The ChatGPT `account_id` currently signed in to the real Codex home, if any.
fn codex_real_home_account_id(real_home: Option<&Path>) -> Option<String> {
    let text = std::fs::read_to_string(real_home?.join("auth.json")).ok()?;
    extract_codex_account_id(&text)
}

/// Identity of the account currently signed in to the local Claude CLI, read
/// from `~/.claude.json`'s `oauthAccount` — the stable `accountUuid`, falling
/// back to `emailAddress`. Used to decide which registered account is the local
/// login (Claude setup-tokens are opaque and carry no identity of their own).
fn claude_local_identity() -> Option<String> {
    let path = dirs::home_dir()?.join(".claude.json");
    let text = std::fs::read_to_string(&path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    let oauth = value.get("oauthAccount")?;
    oauth
        .get("accountUuid")
        .and_then(|v| v.as_str())
        .or_else(|| oauth.get("emailAddress").and_then(|v| v.as_str()))
        .map(str::to_string)
}

/// Env for a registered Claude account. When its captured identity matches the
/// current local login, return an empty map so it probes exactly like the
/// default account (local credentials → full usage + real spend). Otherwise use
/// the inference-only setup token and flag local logs unavailable, so it never
/// shows another login's `~/.claude` spend.
fn claude_account_env(
    token: &str,
    stored_identity: Option<&str>,
    local_identity: Option<&str>,
) -> HashMap<String, String> {
    let matched = matches!((stored_identity, local_identity), (Some(s), Some(l)) if s == l);
    let mut env = HashMap::new();
    if !matched {
        env.insert("CLAUDE_CODE_OAUTH_TOKEN".to_string(), token.to_string());
        env.insert("USAGEPAL_LOCAL_LOGS_UNAVAILABLE".to_string(), "1".to_string());
    }
    env
}

/// Extra env for a Codex account's spend (ccusage) source. Local session logs are
/// not account-tagged, so only the account matching the current local login can
/// read real spend (from `real_home`); every other registered account is flagged
/// as having no local logs so the plugin shows a "no local data" state instead of
/// a misleading $0 or another account's spend.
fn codex_spend_env(
    account_id: &str,
    real_home: Option<&Path>,
    real_home_account_id: Option<&str>,
) -> Vec<(String, String)> {
    match (real_home, real_home_account_id) {
        (Some(home), Some(real_id)) if real_id == account_id => vec![(
            "CODEX_CCUSAGE_HOME".to_string(),
            home.to_string_lossy().to_string(),
        )],
        _ => vec![("USAGEPAL_LOCAL_LOGS_UNAVAILABLE".to_string(), "1".to_string())],
    }
}

/// The API key currently signed in to the local OpenCode CLI, if any. Read from
/// `~/.local/share/opencode/auth.json`'s `opencode-go.key` field — the same
/// field the plugin's `loadApiKey` reads for the default (unregistered) probe.
fn opencode_go_local_login_key() -> Option<String> {
    let path = dirs::home_dir()?.join(".local/share/opencode/auth.json");
    let text = std::fs::read_to_string(&path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value
        .get("opencode-go")?
        .get("key")
        .and_then(|v| v.as_str())
        .map(str::to_string)
}

/// Extra env for an OpenCode Go account's local spend source. The local
/// `opencode.db` is machine-wide with no per-key attribution, so only the
/// account whose API key matches the current local CLI login can read real
/// spend; every other registered account is flagged as having no local logs so
/// the plugin shows a "no local data" state instead of another login's spend.
fn opencode_go_spend_env(
    account_key: &str,
    real_login_key: Option<&str>,
) -> Vec<(String, String)> {
    match real_login_key {
        Some(real_key) if real_key == account_key => vec![],
        _ => vec![("USAGEPAL_LOCAL_LOGS_UNAVAILABLE".to_string(), "1".to_string())],
    }
}

fn codex_staging_dir(app_data_dir: &Path, staging_id: &str) -> PathBuf {
    app_data_dir
        .join("accounts")
        .join("codex")
        .join(".staging")
        .join(staging_id)
}

/// Event payload emitted when a Codex login finishes on its own (the watcher
/// below), so the UI completes without a button the tray panel would hide.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexLoginComplete {
    account_id: String,
    label: String,
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct CodexLoginFailed {
    message: String,
}

/// Move a completed staging login into its final per-account profile dir and
/// return the resolved account id. Shared by the auto-watcher and the manual
/// `finish_codex_login` fallback.
fn finalize_codex_login(app_data_dir: &Path, staging_id: &str) -> Result<String, String> {
    let staging = codex_staging_dir(app_data_dir, staging_id);
    let auth_path = staging.join("auth.json");
    let text = std::fs::read_to_string(&auth_path)
        .map_err(|_| "No Codex login found yet. Finish signing in, then try again.".to_string())?;
    let account_id =
        extract_codex_account_id(&text).ok_or("Codex auth.json had no account_id.")?;

    let final_dir = codex_profile_dir(app_data_dir, &account_id);
    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir).ok(); // re-adding the same account overwrites
    }
    if let Some(parent) = final_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("Couldn't create dir: {e}"))?;
    }
    std::fs::rename(&staging, &final_dir)
        .map_err(|e| format!("Couldn't finalize the profile: {e}"))?;
    Ok(account_id)
}

#[tauri::command]
#[specta::specta]
pub fn begin_codex_login(
    app: tauri::AppHandle,
    state: tauri::State<'_, std::sync::Mutex<crate::AppState>>,
    label: String,
) -> Result<CodexLoginStarted, String> {
    let app_data_dir = state.lock().map_err(|e| e.to_string())?.app_data_dir.clone();
    let staging_id = uuid::Uuid::new_v4().to_string();
    let dir = codex_staging_dir(&app_data_dir, &staging_id);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Couldn't create the profile dir: {e}"))?;

    // Detached, interactive login into the managed CODEX_HOME (opens a browser).
    // A Finder/Dock launch inherits a minimal PATH (no Homebrew/npm), so resolve
    // the user's real login-shell PATH the way the usage plugins do — otherwise
    // `codex` isn't found even when it's installed.
    #[cfg(target_os = "macos")]
    {
        let mut cmd = std::process::Command::new("codex");
        cmd.arg("login").env("CODEX_HOME", &dir);
        if let Some(path) = crate::plugin_engine::host_api::read_env_from_interactive_shells("PATH")
        {
            cmd.env("PATH", path);
        }
        cmd.spawn().map_err(|_| {
            "Couldn't launch `codex`. Is the Codex CLI installed? (npm i -g @openai/codex)"
                .to_string()
        })?;
    }

    // Watch the staging dir and finalize on our own, so completion never depends
    // on the tray panel staying open (it hides the moment the browser takes
    // focus). Emits `codex:login-complete` / `codex:login-failed` for the UI.
    let watch_dir = app_data_dir.clone();
    let watch_staging = staging_id.clone();
    std::thread::spawn(move || {
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(300);
        loop {
            std::thread::sleep(std::time::Duration::from_secs(2));
            let auth = codex_staging_dir(&watch_dir, &watch_staging).join("auth.json");
            // Only act once auth.json exists AND carries an account_id — codex may
            // create the file a moment before it finishes writing the tokens.
            if auth.exists()
                && std::fs::read_to_string(&auth)
                    .ok()
                    .and_then(|t| extract_codex_account_id(&t))
                    .is_some()
            {
                match finalize_codex_login(&watch_dir, &watch_staging) {
                    Ok(account_id) => {
                        let _ = app.emit(
                            "codex:login-complete",
                            CodexLoginComplete { account_id, label },
                        );
                    }
                    Err(message) => {
                        let _ = app.emit("codex:login-failed", CodexLoginFailed { message });
                    }
                }
                return;
            }
            if std::time::Instant::now() >= deadline {
                let _ = app.emit(
                    "codex:login-failed",
                    CodexLoginFailed {
                        message: "Timed out waiting for the Codex sign-in to finish.".to_string(),
                    },
                );
                return;
            }
        }
    });

    Ok(CodexLoginStarted { staging_id })
}

#[tauri::command]
#[specta::specta]
pub fn finish_codex_login(
    state: tauri::State<'_, std::sync::Mutex<crate::AppState>>,
    staging_id: String,
) -> Result<AccountAdded, String> {
    let app_data_dir = state.lock().map_err(|e| e.to_string())?.app_data_dir.clone();
    let account_id = finalize_codex_login(&app_data_dir, &staging_id)?;
    Ok(AccountAdded { account_id })
}

fn delete_account_secret(
    app_data_dir: &Path,
    provider_id: &str,
    account_id: &str,
) -> Result<(), String> {
    match provider_id {
        "codex" => {
            let dir = codex_profile_dir(app_data_dir, account_id);
            if dir.exists() {
                std::fs::remove_dir_all(&dir)
                    .map_err(|e| format!("Couldn't remove profile: {e}"))?;
            }
        }
        "claude" | "cursor" | "opencode-go" => {
            let path = match provider_id {
                "claude" => claude_secret_path(account_id),
                "cursor" => cursor_secret_path(account_id),
                _ => opencode_go_secret_path(account_id),
            }
            .ok_or("No home directory available.")?;
            if path.exists() {
                std::fs::remove_file(&path).map_err(|e| format!("Couldn't remove secret: {e}"))?;
            }
        }
        _ => return Err(format!("Unknown provider: {provider_id}")),
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn remove_account(
    state: tauri::State<'_, std::sync::Mutex<crate::AppState>>,
    provider_id: String,
    account_id: String,
) -> Result<(), String> {
    let app_data_dir = state.lock().map_err(|e| e.to_string())?.app_data_dir.clone();
    delete_account_secret(&app_data_dir, &provider_id, &account_id)
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
    fn opencode_go_secret_roundtrips_api_key() {
        let dir = tmp_dir("opencode-go-secret");
        let path = dir.join("acc.json");
        write_private_file(&path, &serde_json::json!({ "apiKey": "opck-abc123" }).to_string())
            .unwrap();
        assert_eq!(
            read_json_string_field(&path, "apiKey").as_deref(),
            Some("opck-abc123")
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
    fn extract_codex_account_id_reads_nested_field() {
        let text = r#"{"tokens":{"access_token":"x","account_id":"acct_123","refresh_token":"r"}}"#;
        assert_eq!(extract_codex_account_id(text), Some("acct_123".to_string()));
    }

    #[test]
    fn extract_codex_account_id_none_when_absent() {
        assert_eq!(extract_codex_account_id(r#"{"tokens":{}}"#), None);
        assert_eq!(extract_codex_account_id("garbage"), None);
    }

    #[test]
    fn codex_spend_env_points_ccusage_at_real_home_for_the_local_login() {
        let home = PathBuf::from("/Users/x/.codex");
        let env = codex_spend_env("acct_1", Some(&home), Some("acct_1"));
        assert_eq!(
            env,
            vec![(
                "CODEX_CCUSAGE_HOME".to_string(),
                "/Users/x/.codex".to_string()
            )]
        );
    }

    #[test]
    fn claude_account_env_is_empty_for_the_matching_local_login() {
        // Matched → no overrides → probes like the default (local creds).
        let env = claude_account_env("tok", Some("uuid-1"), Some("uuid-1"));
        assert!(env.is_empty());
    }

    #[test]
    fn claude_account_env_uses_token_and_flag_for_other_accounts() {
        let env = claude_account_env("tok", Some("uuid-1"), Some("uuid-2"));
        assert_eq!(env.get("CLAUDE_CODE_OAUTH_TOKEN").map(String::as_str), Some("tok"));
        assert_eq!(
            env.get("USAGEPAL_LOCAL_LOGS_UNAVAILABLE").map(String::as_str),
            Some("1")
        );
        // No captured identity, or no local login → not matched (honest default).
        assert!(!claude_account_env("tok", None, Some("uuid-2")).is_empty());
        assert!(!claude_account_env("tok", Some("uuid-1"), None).is_empty());
    }

    #[test]
    fn codex_spend_env_flags_no_local_logs_for_other_accounts() {
        let home = PathBuf::from("/Users/x/.codex");
        // A different account is signed in locally.
        let env = codex_spend_env("acct_2", Some(&home), Some("acct_1"));
        assert_eq!(
            env,
            vec![("USAGEPAL_LOCAL_LOGS_UNAVAILABLE".to_string(), "1".to_string())]
        );
        // No local login at all.
        let env = codex_spend_env("acct_2", Some(&home), None);
        assert_eq!(
            env,
            vec![("USAGEPAL_LOCAL_LOGS_UNAVAILABLE".to_string(), "1".to_string())]
        );
    }

    #[test]
    fn opencode_go_spend_env_is_empty_for_the_matching_local_login() {
        // Matched key → no overrides → the plugin reads the local database.
        let env = opencode_go_spend_env("go-key-1", Some("go-key-1"));
        assert!(env.is_empty());
    }

    #[test]
    fn opencode_go_spend_env_flags_no_local_logs_for_other_accounts() {
        // A different key is signed in locally.
        let env = opencode_go_spend_env("go-key-2", Some("go-key-1"));
        assert_eq!(
            env,
            vec![("USAGEPAL_LOCAL_LOGS_UNAVAILABLE".to_string(), "1".to_string())]
        );
        // No local login at all.
        let env = opencode_go_spend_env("go-key-2", None);
        assert_eq!(
            env,
            vec![("USAGEPAL_LOCAL_LOGS_UNAVAILABLE".to_string(), "1".to_string())]
        );
    }

    #[test]
    fn opencode_go_local_login_key_reads_nested_auth_field() {
        let dir = tmp_dir("opencode-auth");
        let auth = dir.join(".local/share/opencode/auth.json");
        fs::create_dir_all(auth.parent().unwrap()).unwrap();
        fs::write(
            &auth,
            r#"{"opencode-go":{"type":"api","key":"go-key-1"},"other":{"key":"nope"}}"#,
        )
        .unwrap();

        // Point the helper at the temp file by overriding HOME.
        let original_home = std::env::var_os("HOME");
        unsafe { std::env::set_var("HOME", &dir) };
        let key = opencode_go_local_login_key();
        if let Some(home) = original_home {
            unsafe { std::env::set_var("HOME", home) };
        } else {
            unsafe { std::env::remove_var("HOME") };
        }

        assert_eq!(key, Some("go-key-1".to_string()));
    }

    #[test]
    fn opencode_go_local_login_key_none_when_absent() {
        let dir = tmp_dir("opencode-auth-missing");
        let original_home = std::env::var_os("HOME");
        unsafe { std::env::set_var("HOME", &dir) };
        let key = opencode_go_local_login_key();
        if let Some(home) = original_home {
            unsafe { std::env::set_var("HOME", home) };
        } else {
            unsafe { std::env::remove_var("HOME") };
        }

        assert_eq!(key, None);
    }

    #[test]
    fn finalize_codex_login_moves_staging_into_profile_dir() {
        let app_data = tmp_dir("finalize");
        let staging_id = "stg-1";
        let staging = codex_staging_dir(&app_data, staging_id);
        fs::create_dir_all(&staging).unwrap();
        fs::write(
            staging.join("auth.json"),
            r#"{"tokens":{"account_id":"acct_final"}}"#,
        )
        .unwrap();

        let account_id = finalize_codex_login(&app_data, staging_id).unwrap();
        assert_eq!(account_id, "acct_final");

        // Staging is consumed; the profile dir now holds the auth.json.
        assert!(!staging.exists());
        let profile = codex_profile_dir(&app_data, "acct_final");
        assert!(profile.join("auth.json").exists());
    }

    #[test]
    fn finalize_codex_login_errors_when_login_not_finished() {
        let app_data = tmp_dir("finalize-missing");
        assert!(finalize_codex_login(&app_data, "never-started").is_err());
    }

    #[test]
    fn delete_account_secret_removes_codex_profile_dir() {
        let app_data = tmp_dir("rm-codex");
        let dir = codex_profile_dir(&app_data, "c9");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("auth.json"), "{}").unwrap();
        delete_account_secret(&app_data, "codex", "c9").unwrap();
        assert!(!dir.exists());
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
