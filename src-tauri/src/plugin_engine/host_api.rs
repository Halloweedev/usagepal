use aes_gcm::{
    AesGcm, Nonce,
    aead::{Aead, KeyInit, OsRng, generic_array::typenum::U16, rand_core::RngCore},
    aes::Aes256,
};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64_STANDARD};
use rquickjs::{function::Rest, Ctx, Exception, Function, Object};

use super::ccusage;
use super::pricing_cache;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, Instant};

const WHITELISTED_ENV_VARS: [&str; 19] = [
    "CODEX_HOME",
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "USER_TYPE",
    "USE_STAGING_OAUTH",
    "USE_LOCAL_OAUTH",
    "CLAUDE_CODE_CUSTOM_OAUTH_URL",
    "CLAUDE_CODE_OAUTH_CLIENT_ID",
    "CLAUDE_LOCAL_OAUTH_API_BASE",
    "ZAI_API_KEY",
    "GLM_API_KEY",
    "MINIMAX_API_KEY",
    "MINIMAX_API_TOKEN",
    "MINIMAX_CN_API_KEY",
    "SYNTHETIC_API_KEY",
    "PI_CODING_AGENT_DIR",
    "OPENROUTER_API_KEY",
    "OPENROUTER_KEY",
    "CLINE_API_KEY",
];
const MIN_BLOCKING_TIMEOUT: Duration = Duration::from_millis(1);
/// Ceiling on a single ccusage load, clamped further by the probe deadline.
/// Same 15s the `bunx ccusage` subprocess allowed each attempt before killing
/// its process group — ccusage is the longest host call in a probe, and a huge
/// or network-mounted `~/.claude` must not pin a probe worker indefinitely.
const CCUSAGE_TIMEOUT: Duration = Duration::from_secs(15);

// Redaction patterns are compiled once and reused. They previously recompiled
// on every call — `redact_body` alone built ~6 fixed regexes plus one per
// sensitive key (~36) on each HTTP response logged, which runs on the probe
// hot path. The pattern strings are unchanged; only the compilation moved.
static ANSI_ESCAPE_RE: LazyLock<regex_lite::Regex> =
    LazyLock::new(|| regex_lite::Regex::new(r"\x1B\[[0-?]*[ -/]*[@-~]").expect("valid ansi regex"));

static JWT_RE: LazyLock<regex_lite::Regex> = LazyLock::new(|| {
    regex_lite::Regex::new(r"eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
        .expect("valid jwt regex")
});

/// Body variant keeps the optional surrounding quotes from the original pattern.
static API_KEY_BODY_RE: LazyLock<regex_lite::Regex> = LazyLock::new(|| {
    regex_lite::Regex::new(r#"["']?(sk-|pk-|api_|key_|secret_)[A-Za-z0-9_-]{12,}["']?"#)
        .expect("valid api key body regex")
});

/// Log variant has no surrounding quotes (matches inline tokens in messages).
static API_KEY_LOG_RE: LazyLock<regex_lite::Regex> = LazyLock::new(|| {
    regex_lite::Regex::new(r#"(sk-|pk-|api_|key_|secret_)[A-Za-z0-9_-]{12,}"#)
        .expect("valid api key log regex")
});

static DEVIN_SESSION_RE: LazyLock<regex_lite::Regex> = LazyLock::new(|| {
    regex_lite::Regex::new(r#"devin-session-token\$[^\s"',}\]]+"#).expect("valid devin session regex")
});

static ACCOUNT_RE: LazyLock<regex_lite::Regex> =
    LazyLock::new(|| regex_lite::Regex::new(r#"(account=)([^,\s]+)"#).expect("valid account regex"));

static PATH_RE: LazyLock<regex_lite::Regex> = LazyLock::new(|| {
    regex_lite::Regex::new(r#"(/(?:Users|home|opt|private|var|tmp|Applications)/[^\s"')]+)"#)
        .expect("valid path regex")
});

/// JSON keys whose string values get redacted in response bodies. Order is
/// preserved from the original inline list because redaction applies the
/// patterns sequentially.
const SENSITIVE_JSON_KEYS: &[&str] = &[
    "name",
    "password",
    "token",
    "access_token",
    "refresh_token",
    "secret",
    "api_key",
    "apiKey",
    "authorization",
    "bearer",
    "credential",
    "session_token",
    "sessionToken",
    "auth_token",
    "authToken",
    "id_token",
    "idToken",
    "accessToken",
    "refreshToken",
    "user_id",
    "userId",
    "account_id",
    "accountId",
    "team_id",
    "teamId",
    "org_id",
    "orgId",
    "account_display_name",
    "accountDisplayName",
    "displayName",
    "displayText",
    "payment_id",
    "paymentId",
    "subscription_id",
    "subscriptionId",
    "profile_arn",
    "profileArn",
    "email",
    "login",
    "analytics_tracking_id",
];

/// Precompiled `"key": "value"` matchers, paired with their key for replacement.
static SENSITIVE_JSON_KEY_RES: LazyLock<Vec<(&'static str, regex_lite::Regex)>> =
    LazyLock::new(|| {
        SENSITIVE_JSON_KEYS
            .iter()
            .map(|key| {
                let pattern = format!(r#""{}":\s*"([^"]+)""#, key);
                (
                    *key,
                    regex_lite::Regex::new(&pattern).expect("valid sensitive key regex"),
                )
            })
            .collect()
    });

const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(10);

/// Process-wide blocking HTTP client with connection pooling, built once and
/// shared across all plugin probes. Previously a fresh client (and connection
/// pool + internal runtime) was constructed for every request. The proxy
/// (process-wide, resolved at startup) and a fixed connect timeout are baked
/// in; the per-request total timeout is applied on the `RequestBuilder`.
/// Returns `None` only if the client fails to build.
fn shared_http_client() -> Option<&'static reqwest::blocking::Client> {
    static CLIENT: OnceLock<Option<reqwest::blocking::Client>> = OnceLock::new();
    CLIENT.get_or_init(|| build_http_client(false)).as_ref()
}

/// Variant that accepts invalid TLS certs, for plugins opting into
/// `dangerouslyIgnoreTls`. Built lazily, only if some plugin actually asks.
fn shared_http_client_insecure() -> Option<&'static reqwest::blocking::Client> {
    static CLIENT: OnceLock<Option<reqwest::blocking::Client>> = OnceLock::new();
    CLIENT.get_or_init(|| build_http_client(true)).as_ref()
}

fn build_http_client(accept_invalid_certs: bool) -> Option<reqwest::blocking::Client> {
    let mut builder = reqwest::blocking::Client::builder()
        .connect_timeout(HTTP_CONNECT_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none());
    if let Some(resolved) = crate::config::get_resolved_proxy() {
        builder = builder.proxy(resolved.proxy.clone());
    }
    if accept_invalid_certs {
        builder = builder.danger_accept_invalid_certs(true);
    }
    match builder.build() {
        Ok(client) => Some(client),
        Err(e) => {
            log::warn!("failed to build shared http client: {}", e);
            None
        }
    }
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct ProbeDeadline {
    expires_at: Option<Instant>,
}

impl ProbeDeadline {
    #[cfg(test)]
    pub(crate) fn none() -> Self {
        Self { expires_at: None }
    }

    pub(crate) fn at(expires_at: Instant) -> Self {
        Self {
            expires_at: Some(expires_at),
        }
    }

    pub(crate) fn has_elapsed(self) -> bool {
        self.expires_at
            .map(|expires_at| Instant::now() >= expires_at)
            .unwrap_or(false)
    }

    fn clamp_duration(self, requested: Duration) -> Option<Duration> {
        let Some(expires_at) = self.expires_at else {
            return Some(requested);
        };
        let remaining = expires_at
            .checked_duration_since(Instant::now())
            .filter(|remaining| *remaining >= MIN_BLOCKING_TIMEOUT)?;
        Some(requested.min(remaining))
    }
}

fn log_probe_deadline_skip(plugin_id: &str, operation: &str) {
    log::warn!(
        "[plugin:{}] {} skipped: probe timed out",
        plugin_id,
        operation
    );
}

fn probe_timeout_error<'js>(ctx: &Ctx<'js>) -> rquickjs::Error {
    Exception::throw_message(ctx, "probe timed out")
}

fn last_non_empty_trimmed_line(text: &str) -> Option<String> {
    text.lines()
        .map(|line| line.trim())
        .rev()
        .find(|line| !line.is_empty())
        .map(|line| line.to_string())
}

fn sanitize_env_value(text: &str) -> Option<String> {
    let mut cleaned = ANSI_ESCAPE_RE.replace_all(text, "").to_string();
    cleaned.retain(|ch| ch == '\n' || ch == '\r' || ch == '\t' || !ch.is_control());
    last_non_empty_trimmed_line(&cleaned)
}

fn extract_marked_value(text: &str, start_marker: &str, end_marker: &str) -> Option<String> {
    let start = text.find(start_marker)?;
    let after_start = &text[start + start_marker.len()..];
    let end = after_start.find(end_marker)?;
    sanitize_env_value(&after_start[..end])
}

fn parse_interactive_shell_env_output(
    text: &str,
    start_marker: &str,
    end_marker: &str,
) -> Option<String> {
    if let Some(marked) = extract_marked_value(text, start_marker, end_marker) {
        return Some(marked);
    }

    let has_complete_markers = text.contains(start_marker) && text.contains(end_marker);
    if has_complete_markers {
        return None;
    }

    sanitize_env_value(text)
}

fn read_env_from_process(name: &str) -> Option<String> {
    let value = std::env::var(name).ok()?;
    sanitize_env_value(&value)
}

fn read_command_stdout(program: &str, args: &[&str]) -> Option<String> {
    let output = Command::new(program).args(args).output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).into_owned())
}

fn read_env_value_via_command(program: &str, args: &[&str]) -> Option<String> {
    let stdout = read_command_stdout(program, args)?;
    sanitize_env_value(&stdout)
}

fn current_macos_keychain_account_from_user_env(user_env: Option<String>) -> String {
    user_env
        .and_then(|value| {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        })
        .or_else(|| read_env_value_via_command("id", &["-un"]))
        .unwrap_or_else(|| "usagepal-user".to_string())
}

fn current_macos_keychain_account() -> String {
    current_macos_keychain_account_from_user_env(read_env_from_process("USER"))
}

fn keychain_find_generic_password_args(service: &str) -> Vec<OsString> {
    vec![
        OsString::from("find-generic-password"),
        OsString::from("-s"),
        OsString::from(service),
        OsString::from("-w"),
    ]
}

fn keychain_find_generic_password_args_for_account(service: &str, account: &str) -> Vec<OsString> {
    vec![
        OsString::from("find-generic-password"),
        OsString::from("-a"),
        OsString::from(account),
        OsString::from("-s"),
        OsString::from(service),
        OsString::from("-w"),
    ]
}

fn keychain_add_generic_password_args(service: &str, value: &str) -> Vec<OsString> {
    vec![
        OsString::from("add-generic-password"),
        OsString::from("-U"),
        OsString::from("-s"),
        OsString::from(service),
        OsString::from("-w"),
        OsString::from(value),
    ]
}

fn keychain_add_generic_password_args_for_account(
    service: &str,
    account: &str,
    value: &str,
) -> Vec<OsString> {
    vec![
        OsString::from("add-generic-password"),
        OsString::from("-U"),
        OsString::from("-a"),
        OsString::from(account),
        OsString::from("-s"),
        OsString::from(service),
        OsString::from("-w"),
        OsString::from(value),
    ]
}

fn terminal_env_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn shell_from_env() -> Option<String> {
    let shell = std::env::var("SHELL").ok()?;
    let trimmed = shell.trim();
    if trimmed.is_empty() {
        return None;
    }
    let file = std::path::Path::new(trimmed).file_name()?.to_string_lossy();
    let allowed = file == "zsh" || file == "bash" || file == "fish";
    if allowed {
        Some(trimmed.to_string())
    } else {
        None
    }
}

fn read_env_from_interactive_shell(program: &str, name: &str) -> Option<String> {
    const START_MARKER: &str = "__OPENUSAGE_ENV_START__";
    const END_MARKER: &str = "__OPENUSAGE_ENV_END__";

    let script = format!(
        "printf '{}\\n'; printenv {}; printf '{}\\n'",
        START_MARKER, name, END_MARKER
    );
    let output = read_command_stdout(program, &["-ilc", script.as_str()])?;
    parse_interactive_shell_env_output(&output, START_MARKER, END_MARKER)
}

fn read_env_from_interactive_shells(name: &str) -> Option<String> {
    let mut programs: Vec<String> = Vec::new();

    if let Some(shell) = shell_from_env() {
        programs.push(shell);
    }

    for program in [
        "/bin/zsh",
        "/bin/bash",
        "/opt/homebrew/bin/fish",
        "/usr/local/bin/fish",
        "/opt/local/bin/fish",
    ] {
        if !programs.iter().any(|p| p == program) {
            programs.push(program.to_string());
        }
    }

    for program in programs {
        if let Some(value) = read_env_from_interactive_shell(program.as_str(), name) {
            return Some(value);
        }
    }

    None
}

fn resolve_env_value(name: &str) -> Option<String> {
    // Prefer the current process env (fast + supports launchctl/terminal-launch).
    if let Some(value) = read_env_from_process(name) {
        return Some(value);
    }

    if let Ok(cache) = terminal_env_cache().lock() {
        if let Some(cached) = cache.get(name) {
            return cached.clone();
        }
    }

    let resolved = read_env_from_interactive_shells(name);
    if let Ok(mut cache) = terminal_env_cache().lock() {
        cache.insert(name.to_string(), resolved.clone());
    }
    resolved
}

/// Redact sensitive value to first4...last4 format (UTF-8 safe)
fn redact_value(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    if chars.len() <= 12 {
        "[REDACTED]".to_string()
    } else {
        let first4: String = chars.iter().take(4).collect();
        let last4: String = chars
            .iter()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        format!("{}...{}", first4, last4)
    }
}

/// Redact sensitive query parameters in URL
fn redact_url(url: &str) -> String {
    let sensitive_params = [
        "key",
        "api_key",
        "apikey",
        "token",
        "access_token",
        "secret",
        "password",
        "auth",
        "authorization",
        "bearer",
        "credential",
        "user",
        "user_id",
        "userid",
        "account_id",
        "accountid",
        "profilearn",
        "profile_arn",
        "email",
        "login",
    ];

    if let Some(query_start) = url.find('?') {
        let (base, query) = url.split_at(query_start + 1);
        let redacted_params: Vec<String> = query
            .split('&')
            .map(|param| {
                if let Some(eq_pos) = param.find('=') {
                    let (name, value) = param.split_at(eq_pos);
                    let value = &value[1..]; // skip '='
                    let name_lower = name.to_lowercase();
                    if sensitive_params.iter().any(|s| name_lower.contains(s)) && !value.is_empty()
                    {
                        format!("{}={}", name, redact_value(value))
                    } else {
                        param.to_string()
                    }
                } else {
                    param.to_string()
                }
            })
            .collect();
        format!("{}{}", base, redacted_params.join("&"))
    } else {
        url.to_string()
    }
}

/// Redact sensitive patterns in response body for logging
fn redact_body(body: &str) -> String {
    let mut result = body.to_string();

    // Redact JWTs (eyJ... pattern with dots)
    result = JWT_RE
        .replace_all(&result, |caps: &regex_lite::Captures| {
            redact_value(&caps[0])
        })
        .to_string();

    // Redact common API key patterns (sk-xxx, pk-xxx, api_xxx, etc.)
    result = API_KEY_BODY_RE
        .replace_all(&result, |caps: &regex_lite::Captures| {
            let key = caps[0].trim_matches(|c| c == '"' || c == '\'');
            redact_value(key)
        })
        .to_string();

    result = DEVIN_SESSION_RE
        .replace_all(&result, |caps: &regex_lite::Captures| {
            redact_value(&caps[0])
        })
        .to_string();

    // Redact JSON values for sensitive keys ("key": "value" or "key":"value")
    for (key, re) in SENSITIVE_JSON_KEY_RES.iter() {
        result = re
            .replace_all(&result, |caps: &regex_lite::Captures| {
                let value = &caps[1];
                format!("\"{}\": \"{}\"", key, redact_value(value))
            })
            .to_string();
    }

    result = PATH_RE.replace_all(&result, "[PATH]").to_string();

    result
}

/// Lightweight redaction for log messages.
pub(crate) fn redact_log_message(msg: &str) -> String {
    let mut result = msg.to_string();
    result = JWT_RE
        .replace_all(&result, |caps: &regex_lite::Captures| {
            redact_value(&caps[0])
        })
        .to_string();
    result = API_KEY_LOG_RE
        .replace_all(&result, |caps: &regex_lite::Captures| {
            redact_value(&caps[0])
        })
        .to_string();
    result = DEVIN_SESSION_RE
        .replace_all(&result, |caps: &regex_lite::Captures| {
            redact_value(&caps[0])
        })
        .to_string();
    result = ACCOUNT_RE
        .replace_all(&result, |caps: &regex_lite::Captures| {
            format!("{}{}", &caps[1], redact_value(&caps[2]))
        })
        .to_string();
    result = PATH_RE.replace_all(&result, "[PATH]").to_string();
    result
}

fn decrypt_aes_256_gcm_envelope(envelope: &str, key_b64: &str) -> Result<String, String> {
    let trimmed_envelope = envelope.trim();
    let trimmed_key = key_b64.trim();
    let parts: Vec<&str> = trimmed_envelope.split(':').collect();
    if parts.len() != 3 {
        return Err("invalid AES-GCM envelope".to_string());
    }

    let key = BASE64_STANDARD
        .decode(trimmed_key)
        .map_err(|e| format!("invalid base64 key: {}", e))?;
    if key.len() != 32 {
        return Err(format!(
            "invalid AES-256 key length: expected 32 bytes, got {}",
            key.len()
        ));
    }

    let iv = BASE64_STANDARD
        .decode(parts[0])
        .map_err(|e| format!("invalid base64 iv: {}", e))?;
    if iv.len() != 16 {
        return Err(format!(
            "invalid AES-GCM iv length: expected 16 bytes, got {}",
            iv.len()
        ));
    }

    let tag = BASE64_STANDARD
        .decode(parts[1])
        .map_err(|e| format!("invalid base64 auth tag: {}", e))?;
    if tag.len() != 16 {
        return Err(format!(
            "invalid AES-GCM auth tag length: expected 16 bytes, got {}",
            tag.len()
        ));
    }

    let ciphertext = BASE64_STANDARD
        .decode(parts[2])
        .map_err(|e| format!("invalid base64 ciphertext: {}", e))?;

    type Aes256Gcm16 = AesGcm<Aes256, U16>;
    let cipher =
        Aes256Gcm16::new_from_slice(&key).map_err(|e| format!("decrypt init failed: {}", e))?;
    let nonce = Nonce::<U16>::from_slice(&iv);

    let mut ciphertext_and_tag = ciphertext;
    ciphertext_and_tag.extend_from_slice(&tag);
    let plaintext = cipher
        .decrypt(nonce, ciphertext_and_tag.as_ref())
        .map_err(|_| "decrypt finalize failed".to_string())?;

    String::from_utf8(plaintext).map_err(|e| format!("decrypted payload is not UTF-8: {}", e))
}

fn encrypt_aes_256_gcm_envelope(plaintext: &str, key_b64: &str) -> Result<String, String> {
    let trimmed_key = key_b64.trim();
    let key = BASE64_STANDARD
        .decode(trimmed_key)
        .map_err(|e| format!("invalid base64 key: {}", e))?;
    if key.len() != 32 {
        return Err(format!(
            "invalid AES-256 key length: expected 32 bytes, got {}",
            key.len()
        ));
    }

    type Aes256Gcm16 = AesGcm<Aes256, U16>;
    let cipher =
        Aes256Gcm16::new_from_slice(&key).map_err(|e| format!("encrypt init failed: {}", e))?;
    let mut iv = [0_u8; 16];
    OsRng.fill_bytes(&mut iv);
    let nonce = Nonce::<U16>::from_slice(&iv);
    let ciphertext_and_tag = cipher
        .encrypt(nonce, plaintext.as_bytes())
        .map_err(|_| "encrypt finalize failed".to_string())?;
    if ciphertext_and_tag.len() < 16 {
        return Err("encrypted payload missing auth tag".to_string());
    }
    let split_at = ciphertext_and_tag.len() - 16;
    let (ciphertext, tag) = ciphertext_and_tag.split_at(split_at);

    Ok(format!(
        "{}:{}:{}",
        BASE64_STANDARD.encode(iv),
        BASE64_STANDARD.encode(tag),
        BASE64_STANDARD.encode(ciphertext)
    ))
}

#[cfg(test)]
pub(crate) fn inject_host_api<'js>(
    ctx: &Ctx<'js>,
    plugin_id: &str,
    app_data_dir: &PathBuf,
    app_version: &str,
) -> rquickjs::Result<()> {
    inject_host_api_with_deadline(
        ctx,
        plugin_id,
        app_data_dir,
        app_version,
        ProbeDeadline::none(),
    )
}

pub(crate) fn inject_host_api_with_deadline<'js>(
    ctx: &Ctx<'js>,
    plugin_id: &str,
    app_data_dir: &PathBuf,
    app_version: &str,
    deadline: ProbeDeadline,
) -> rquickjs::Result<()> {
    let globals = ctx.globals();
    let probe_ctx = Object::new(ctx.clone())?;

    probe_ctx.set("nowIso", iso_now())?;

    let app_obj = Object::new(ctx.clone())?;
    app_obj.set("version", app_version)?;
    app_obj.set("platform", std::env::consts::OS)?;
    app_obj.set("appDataDir", app_data_dir.to_string_lossy().to_string())?;
    let plugin_data_dir = app_data_dir.join("plugins_data").join(plugin_id);
    if let Err(err) = std::fs::create_dir_all(&plugin_data_dir) {
        log::warn!(
            "[plugin:{}] failed to create plugin data dir: {}",
            plugin_id,
            err
        );
    }
    app_obj.set(
        "pluginDataDir",
        plugin_data_dir.to_string_lossy().to_string(),
    )?;
    probe_ctx.set("app", app_obj)?;

    let host = Object::new(ctx.clone())?;
    inject_log(ctx, &host, plugin_id)?;
    inject_fs(ctx, &host)?;
    inject_crypto(ctx, &host)?;
    inject_env(ctx, &host, plugin_id)?;
    inject_http(ctx, &host, plugin_id, deadline)?;
    inject_keychain(ctx, &host, plugin_id)?;
    inject_sqlite(ctx, &host)?;
    inject_ls(ctx, &host, plugin_id)?;
    inject_ccusage(ctx, &host, plugin_id, deadline)?;

    probe_ctx.set("host", host)?;
    globals.set("__openusage_ctx", probe_ctx)?;

    Ok(())
}

fn inject_log<'js>(ctx: &Ctx<'js>, host: &Object<'js>, plugin_id: &str) -> rquickjs::Result<()> {
    let log_obj = Object::new(ctx.clone())?;

    let pid = plugin_id.to_string();
    log_obj.set(
        "info",
        Function::new(ctx.clone(), move |msg: String| {
            log::info!("[plugin:{}] {}", pid, redact_log_message(&msg));
        })?,
    )?;

    let pid = plugin_id.to_string();
    log_obj.set(
        "warn",
        Function::new(ctx.clone(), move |msg: String| {
            log::warn!("[plugin:{}] {}", pid, redact_log_message(&msg));
        })?,
    )?;

    let pid = plugin_id.to_string();
    log_obj.set(
        "error",
        Function::new(ctx.clone(), move |msg: String| {
            log::error!("[plugin:{}] {}", pid, redact_log_message(&msg));
        })?,
    )?;

    host.set("log", log_obj)?;
    Ok(())
}

fn inject_fs<'js>(ctx: &Ctx<'js>, host: &Object<'js>) -> rquickjs::Result<()> {
    let fs_obj = Object::new(ctx.clone())?;

    fs_obj.set(
        "exists",
        Function::new(ctx.clone(), move |path: String| -> bool {
            let expanded = expand_path(&path);
            std::path::Path::new(&expanded).exists()
        })?,
    )?;

    fs_obj.set(
        "readText",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, path: String| -> rquickjs::Result<String> {
                let expanded = expand_path(&path);
                std::fs::read_to_string(&expanded)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))
            },
        )?,
    )?;

    fs_obj.set(
        "writeText",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, path: String, content: String| -> rquickjs::Result<()> {
                let expanded = expand_path(&path);
                std::fs::write(&expanded, &content)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))
            },
        )?,
    )?;

    fs_obj.set(
        "listDir",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, path: String| -> rquickjs::Result<Vec<String>> {
                let expanded = expand_path(&path);
                let entries = std::fs::read_dir(&expanded)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))?;

                let mut names = Vec::new();
                for entry in entries {
                    let entry = match entry {
                        Ok(entry) => entry,
                        Err(_) => continue,
                    };
                    let name_os = entry.file_name();
                    let name = name_os.to_string_lossy().to_string();
                    if !name.is_empty() {
                        names.push(name);
                    }
                }
                names.sort();
                Ok(names)
            },
        )?,
    )?;

    host.set("fs", fs_obj)?;
    Ok(())
}

fn inject_crypto<'js>(ctx: &Ctx<'js>, host: &Object<'js>) -> rquickjs::Result<()> {
    let crypto_obj = Object::new(ctx.clone())?;

    crypto_obj.set(
        "decryptAes256Gcm",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>,
                  envelope: String,
                  key_b64: String|
                  -> rquickjs::Result<String> {
                decrypt_aes_256_gcm_envelope(&envelope, &key_b64)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e))
            },
        )?,
    )?;

    crypto_obj.set(
        "encryptAes256Gcm",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>,
                  plaintext: String,
                  key_b64: String|
                  -> rquickjs::Result<String> {
                encrypt_aes_256_gcm_envelope(&plaintext, &key_b64)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e))
            },
        )?,
    )?;

    crypto_obj.set(
        "sha256Hex",
        Function::new(ctx.clone(), move |text: String| -> String {
            let digest = Sha256::digest(text.as_bytes());
            // Lowercase hex, matches Node's `crypto.createHash("sha256").update(x).digest("hex")`
            // and the upstream Claude Code keychain helper.
            let mut out = String::with_capacity(digest.len() * 2);
            for byte in digest.iter() {
                use std::fmt::Write as _;
                let _ = write!(&mut out, "{:02x}", byte);
            }
            out
        })?,
    )?;

    host.set("crypto", crypto_obj)?;
    Ok(())
}

fn inject_env<'js>(ctx: &Ctx<'js>, host: &Object<'js>, _plugin_id: &str) -> rquickjs::Result<()> {
    let env_obj = Object::new(ctx.clone())?;
    env_obj.set(
        "get",
        Function::new(ctx.clone(), move |name: String| -> Option<String> {
            if !WHITELISTED_ENV_VARS.contains(&name.as_str()) {
                return None;
            }

            resolve_env_value(&name)
        })?,
    )?;
    host.set("env", env_obj)?;
    Ok(())
}

fn inject_http<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    plugin_id: &str,
    deadline: ProbeDeadline,
) -> rquickjs::Result<()> {
    let http_obj = Object::new(ctx.clone())?;
    let pid = plugin_id.to_string();

    http_obj.set(
        "_requestRaw",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, req_json: String| -> rquickjs::Result<String> {
                let req: HttpReqParams = serde_json::from_str(&req_json).map_err(|e| {
                    Exception::throw_message(&ctx_inner, &format!("invalid request: {}", e))
                })?;

                if deadline.has_elapsed() {
                    return Err(Exception::throw_message(&ctx_inner, "probe timed out"));
                }

                let method_str = req.method.as_deref().unwrap_or("GET");
                let redacted_url = redact_url(&req.url);
                log::info!("[plugin:{}] HTTP {} {}", pid, method_str, redacted_url);

                let mut header_map = reqwest::header::HeaderMap::new();
                if let Some(headers) = &req.headers {
                    for (key, val) in headers {
                        let name = reqwest::header::HeaderName::from_bytes(key.as_bytes())
                            .map_err(|e| {
                                Exception::throw_message(
                                    &ctx_inner,
                                    &format!("invalid header name '{}': {}", key, e),
                                )
                            })?;
                        let value = reqwest::header::HeaderValue::from_str(val).map_err(|e| {
                            Exception::throw_message(
                                &ctx_inner,
                                &format!("invalid header value for '{}': {}", key, e),
                            )
                        })?;
                        header_map.insert(name, value);
                    }
                }

                let timeout_ms = req.timeout_ms.unwrap_or(10_000);
                let Some(timeout) = deadline.clamp_duration(Duration::from_millis(timeout_ms))
                else {
                    return Err(probe_timeout_error(&ctx_inner));
                };
                let client = if req.dangerously_ignore_tls.unwrap_or(false) {
                    shared_http_client_insecure()
                } else {
                    shared_http_client()
                };
                let Some(client) = client else {
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        "failed to build http client",
                    ));
                };

                let method = req.method.as_deref().unwrap_or("GET");
                let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|e| {
                    Exception::throw_message(
                        &ctx_inner,
                        &format!("invalid http method '{}': {}", method, e),
                    )
                })?;
                // Per-request total timeout (deadline-clamped) on the shared,
                // connection-pooling client.
                let mut builder = client.request(method, &req.url).timeout(timeout);
                builder = builder.headers(header_map);
                if let Some(body) = req.body_text {
                    builder = builder.body(body);
                }

                let response = builder
                    .send()
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))?;

                let status = response.status().as_u16();
                let mut resp_headers = std::collections::HashMap::new();
                for (key, value) in response.headers().iter() {
                    let header_value = value.to_str().map_err(|e| {
                        Exception::throw_message(
                            &ctx_inner,
                            &format!("invalid response header '{}': {}", key, e),
                        )
                    })?;
                    resp_headers.insert(key.to_string(), header_value.to_string());
                }
                let body = response
                    .text()
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))?;

                // Body redaction runs ~40 regex passes; only do it when the log
                // will actually be emitted. The default log level is Error
                // (see tray::get_stored_log_level), so on a normal run this skips
                // the redaction entirely on the probe hot path.
                if log::log_enabled!(log::Level::Info) {
                    // Redact BEFORE truncation to ensure sensitive values are caught while intact
                    let redacted_body = redact_body(&body);
                    let body_preview = if redacted_body.len() > 500 {
                        // UTF-8 safe truncation: find valid char boundary at or before 500
                        let truncated: String = redacted_body
                            .char_indices()
                            .take_while(|(i, _)| *i < 500)
                            .map(|(_, c)| c)
                            .collect();
                        format!("{}... ({} bytes total)", truncated, body.len())
                    } else {
                        redacted_body
                    };
                    log::info!(
                        "[plugin:{}] HTTP {} {} -> {} | {}",
                        pid,
                        method_str,
                        redacted_url,
                        status,
                        body_preview
                    );
                }

                let resp = HttpRespParams {
                    status,
                    headers: resp_headers,
                    body_text: body,
                };

                serde_json::to_string(&resp)
                    .map_err(|e| Exception::throw_message(&ctx_inner, &e.to_string()))
            },
        )?,
    )?;

    ctx.eval::<(), _>(
        r#"
        (function() {
            // Will be patched after __openusage_ctx is set.
            if (typeof __openusage_ctx !== "undefined") {
                void 0;
            }
        })();
        "#
        .as_bytes(),
    )
    .map_err(|e| Exception::throw_message(ctx, &format!("http wrapper init failed: {}", e)))?;

    host.set("http", http_obj)?;
    Ok(())
}

pub fn patch_http_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.http._requestRaw;
            __openusage_ctx.host.http.request = function(req) {
                var json = JSON.stringify({
                    url: req.url,
                    method: req.method || "GET",
                    headers: req.headers || null,
                    bodyText: req.bodyText || null,
                    timeoutMs: req.timeoutMs || 10000,
                    dangerouslyIgnoreTls: req.dangerouslyIgnoreTls || false
                });
                var respJson = rawFn(json);
                return JSON.parse(respJson);
            };
        })();
        "#
        .as_bytes(),
    )
}

/// Inject utility APIs (line builders, formatters, base64, jwt) onto __openusage_ctx
pub fn inject_utils(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var ctx = __openusage_ctx;

            // Line builders (options object API)
            ctx.line = {
                text: function(opts) {
                    var line = { type: "text", label: opts.label, value: opts.value };
                    if (opts.color) line.color = opts.color;
                    if (opts.subtitle) line.subtitle = opts.subtitle;
                    if (opts.resetExpiry) line.resetExpiry = opts.resetExpiry;
                    return line;
                },
                progress: function(opts) {
                    var line = { type: "progress", label: opts.label, used: opts.used, limit: opts.limit, format: opts.format };
                    if (opts.resetsAt) line.resetsAt = opts.resetsAt;
                    if (opts.periodDurationMs) line.periodDurationMs = opts.periodDurationMs;
                    if (opts.color) line.color = opts.color;
                    return line;
                },
                badge: function(opts) {
                    var line = { type: "badge", label: opts.label, text: opts.text };
                    if (opts.color) line.color = opts.color;
                    if (opts.subtitle) line.subtitle = opts.subtitle;
                    return line;
                },
                barChart: function(opts) {
                    var line = { type: "barChart", label: opts.label, points: opts.points || [] };
                    if (opts.note) line.note = opts.note;
                    if (opts.color) line.color = opts.color;
                    return line;
                }
            };

            // Formatters
            ctx.fmt = {
                planLabel: function(value) {
                    var text = String(value || "").trim();
                    if (!text) return "";
                    return text.replace(/(^|\s)([a-z])/g, function(match, space, letter) {
                        return space + letter.toUpperCase();
                    });
                },
                resetIn: function(secondsUntil) {
                    if (!Number.isFinite(secondsUntil) || secondsUntil < 0) return null;
                    var totalMinutes = Math.floor(secondsUntil / 60);
                    var totalHours = Math.floor(totalMinutes / 60);
                    var days = Math.floor(totalHours / 24);
                    var hours = totalHours % 24;
                    var minutes = totalMinutes % 60;
                    if (days > 0) return days + "d " + hours + "h";
                    if (totalHours > 0) return totalHours + "h " + minutes + "m";
                    if (totalMinutes > 0) return totalMinutes + "m";
                    return "<1m";
                },
                dollars: function(cents) {
                    var d = cents / 100;
                    return Math.round(d * 100) / 100;
                },
                date: function(unixMs) {
                    var d = new Date(Number(unixMs));
                    var months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
                    return months[d.getMonth()] + " " + String(d.getDate());
                }
            };

            // Shared utilities
            ctx.util = {
                tryParseJson: function(text) {
                    if (text === null || text === undefined) return null;
                    var trimmed = String(text).trim();
                    if (!trimmed) return null;
                    try {
                        return JSON.parse(trimmed);
                    } catch (e) {
                        return null;
                    }
                },
                safeJsonParse: function(text) {
                    if (text === null || text === undefined) return { ok: false };
                    var trimmed = String(text).trim();
                    if (!trimmed) return { ok: false };
                    try {
                        return { ok: true, value: JSON.parse(trimmed) };
                    } catch (e) {
                        return { ok: false };
                    }
                },
                request: function(opts) {
                    return ctx.host.http.request(opts);
                },
                requestJson: function(opts) {
                    var resp = ctx.util.request(opts);
                    var parsed = ctx.util.safeJsonParse(resp.bodyText);
                    return { resp: resp, json: parsed.ok ? parsed.value : null };
                },
                isAuthStatus: function(status) {
                    return status === 401 || status === 403;
                },
                retryOnceOnAuth: function(opts) {
                    var resp = opts.request();
                    if (ctx.util.isAuthStatus(resp.status)) {
                        var token = opts.refresh();
                        if (token) {
                            resp = opts.request(token);
                        }
                    }
                    return resp;
                },
                parseDateMs: function(value) {
                    if (value instanceof Date) {
                        var dateMs = value.getTime();
                        return Number.isFinite(dateMs) ? dateMs : null;
                    }
                    if (typeof value === "number") {
                        return Number.isFinite(value) ? value : null;
                    }
                    if (typeof value === "string") {
                        var parsed = Date.parse(value);
                        if (Number.isFinite(parsed)) return parsed;
                        var n = Number(value);
                        return Number.isFinite(n) ? n : null;
                    }
                    return null;
                },
                toIso: function(value) {
                    if (value === null || value === undefined) return null;

                    if (typeof value === "string") {
                        var s = String(value).trim();
                        if (!s) return null;

                        // Common variants
                        // - "YYYY-MM-DD HH:MM:SS" -> "YYYY-MM-DDTHH:MM:SS"
                        // - "... UTC" -> "...Z"
                        if (s.indexOf(" ") !== -1 && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
                            s = s.replace(" ", "T");
                        }
                        if (s.endsWith(" UTC")) {
                            s = s.slice(0, -4) + "Z";
                        }

                        // Numeric strings: treat as seconds/ms.
                        if (/^-?\d+(\.\d+)?$/.test(s)) {
                            var n = Number(s);
                            if (!Number.isFinite(n)) return null;
                            var msNum = Math.abs(n) < 1e10 ? n * 1000 : n;
                            var dn = new Date(msNum);
                            var tn = dn.getTime();
                            if (!Number.isFinite(tn)) return null;
                            return dn.toISOString();
                        }

                        // Normalize timezone offsets without colon: "+0000" -> "+00:00"
                        if (/[+-]\d{4}$/.test(s)) {
                            s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
                        }

                        // Some APIs return RFC3339 with >3 fractional digits (e.g. .123456Z).
                        // Normalize to milliseconds so Date.parse can understand it.
                        var m = s.match(
                            /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
                        );
                        if (m) {
                            var head = m[1];
                            var frac = m[2] || "";
                            var tz = m[3];
                            if (frac) {
                                var digits = frac.slice(1);
                                if (digits.length > 3) digits = digits.slice(0, 3);
                                while (digits.length < 3) digits = digits + "0";
                                frac = "." + digits;
                            }
                            s = head + frac + tz;
                        } else {
                            // ISO-like but missing timezone: assume UTC.
                            var mNoTz = s.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(\.\d+)?$/);
                            if (mNoTz) {
                                var head2 = mNoTz[1];
                                var frac2 = mNoTz[2] || "";
                                if (frac2) {
                                    var digits2 = frac2.slice(1);
                                    if (digits2.length > 3) digits2 = digits2.slice(0, 3);
                                    while (digits2.length < 3) digits2 = digits2 + "0";
                                    frac2 = "." + digits2;
                                }
                                s = head2 + frac2 + "Z";
                            }
                        }

                        var parsed = Date.parse(s);
                        if (!Number.isFinite(parsed)) return null;
                        return new Date(parsed).toISOString();
                    }

                    if (typeof value === "number") {
                        if (!Number.isFinite(value)) return null;
                        var ms = Math.abs(value) < 1e10 ? value * 1000 : value;
                        var d = new Date(ms);
                        var t = d.getTime();
                        if (!Number.isFinite(t)) return null;
                        return d.toISOString();
                    }

                    if (value instanceof Date) {
                        var t = value.getTime();
                        if (!Number.isFinite(t)) return null;
                        return value.toISOString();
                    }

                    return null;
                },
                needsRefreshByExpiry: function(opts) {
                    if (!opts) return true;
                    if (opts.expiresAtMs === null || opts.expiresAtMs === undefined) return true;
                    var nowMs = Number(opts.nowMs);
                    var expiresAtMs = Number(opts.expiresAtMs);
                    var bufferMs = Number(opts.bufferMs);
                    if (!Number.isFinite(nowMs)) return true;
                    if (!Number.isFinite(expiresAtMs)) return true;
                    if (!Number.isFinite(bufferMs)) bufferMs = 0;
                    return nowMs + bufferMs >= expiresAtMs;
                }
            };

            // Base64
            var b64chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
            ctx.base64 = {
                decode: function(str) {
                    str = str.replace(/-/g, "+").replace(/_/g, "/");
                    while (str.length % 4) str += "=";
                    str = str.replace(/=+$/, "");
                    var result = "";
                    var len = str.length;
                    var i = 0;
                    while (i < len) {
                        var remaining = len - i;
                        var a = b64chars.indexOf(str.charAt(i++));
                        var b = b64chars.indexOf(str.charAt(i++));
                        var c = remaining > 2 ? b64chars.indexOf(str.charAt(i++)) : 0;
                        var d = remaining > 3 ? b64chars.indexOf(str.charAt(i++)) : 0;
                        var n = (a << 18) | (b << 12) | (c << 6) | d;
                        result += String.fromCharCode((n >> 16) & 0xff);
                        if (remaining > 2) result += String.fromCharCode((n >> 8) & 0xff);
                        if (remaining > 3) result += String.fromCharCode(n & 0xff);
                    }
                    return result;
                },
                encode: function(str) {
                    var result = "";
                    var len = str.length;
                    var i = 0;
                    while (i < len) {
                        var chunkStart = i;
                        var a = str.charCodeAt(i++);
                        var b = i < len ? str.charCodeAt(i++) : 0;
                        var c = i < len ? str.charCodeAt(i++) : 0;
                        var bytesInChunk = i - chunkStart;
                        var n = (a << 16) | (b << 8) | c;
                        result += b64chars.charAt((n >> 18) & 63);
                        result += b64chars.charAt((n >> 12) & 63);
                        result += bytesInChunk < 2 ? "=" : b64chars.charAt((n >> 6) & 63);
                        result += bytesInChunk < 3 ? "=" : b64chars.charAt(n & 63);
                    }
                    return result;
                }
            };

            // JWT
            ctx.jwt = {
                decodePayload: function(token) {
                    try {
                        var parts = token.split(".");
                        if (parts.length !== 3) return null;
                        var decoded = ctx.base64.decode(parts[1]);
                        return JSON.parse(decoded);
                    } catch (e) {
                        return null;
                    }
                }
            };
        })();
        "#
        .as_bytes(),
    )
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct HttpReqParams {
    url: String,
    method: Option<String>,
    headers: Option<std::collections::HashMap<String, String>>,
    body_text: Option<String>,
    timeout_ms: Option<u64>,
    dangerously_ignore_tls: Option<bool>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HttpRespParams {
    status: u16,
    headers: std::collections::HashMap<String, String>,
    body_text: String,
}

// --- Language Server Discovery ---

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LsDiscoverOpts {
    process_name: String,
    markers: Vec<String>,
    csrf_flag: String,
    port_flag: Option<String>,
    extra_flags: Option<Vec<String>>,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LsDiscoverResult {
    pid: i32,
    csrf: String,
    ports: Vec<i32>,
    extra: std::collections::HashMap<String, String>,
    extension_port: Option<i32>,
}

fn inject_ls<'js>(ctx: &Ctx<'js>, host: &Object<'js>, plugin_id: &str) -> rquickjs::Result<()> {
    let ls_obj = Object::new(ctx.clone())?;
    let pid = plugin_id.to_string();

    ls_obj.set(
        "_discoverRaw",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, opts_json: String| -> rquickjs::Result<String> {
                let opts: LsDiscoverOpts = serde_json::from_str(&opts_json).map_err(|e| {
                    Exception::throw_message(&ctx_inner, &format!("invalid discover opts: {}", e))
                })?;

                log::info!(
                    "[plugin:{}] LS discover: processName={}, markers={:?}",
                    pid,
                    opts.process_name,
                    opts.markers
                );

                let ps_output = match std::process::Command::new("/bin/ps")
                    .args(["-ax", "-o", "pid=,command="])
                    .output()
                {
                    Ok(o) => o,
                    Err(e) => {
                        log::warn!("[plugin:{}] ps failed: {}", pid, e);
                        return Ok("null".to_string());
                    }
                };

                if !ps_output.status.success() {
                    log::warn!("[plugin:{}] ps returned non-zero", pid);
                    return Ok("null".to_string());
                }

                let ps_stdout = String::from_utf8_lossy(&ps_output.stdout);
                let process_name_lower = opts.process_name.to_lowercase();
                let markers_lower: Vec<String> = opts
                    .markers
                    .iter()
                    .map(|m| m.trim().to_lowercase())
                    .filter(|m| !m.is_empty())
                    .collect();

                // Find the target process. Marker patterns are Codeium-derived.
                // Matching priority:
                //   1. Exact --ide_name / --app_data_dir flag value (prevents
                //      "windsurf" matching "windsurf-next")
                //   2. Path substring (/<marker>/) as fallback when no flags found
                let mut candidates: Vec<(u8, i32, String)> = Vec::new();

                for line in ps_stdout.lines() {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    let mut parts = trimmed.splitn(2, char::is_whitespace);
                    let pid_str = match parts.next() {
                        Some(s) => s.trim(),
                        None => continue,
                    };
                    let command = match parts.next() {
                        Some(s) => s.trim(),
                        None => continue,
                    };

                    if !ls_command_matches_process(command, &process_name_lower) {
                        continue;
                    }

                    let Some(marker_rank) = ls_marker_rank(command, &markers_lower) else {
                        continue;
                    };

                    if let Ok(p) = pid_str.parse::<i32>() {
                        candidates.push((marker_rank, p, command.to_string()));
                    }
                }

                if candidates.is_empty() {
                    log::info!("[plugin:{}] LS process not found", pid);
                    return Ok("null".to_string());
                }

                let lsof_path = ["/usr/sbin/lsof", "/usr/bin/lsof"]
                    .iter()
                    .find(|p| std::path::Path::new(p).exists())
                    .copied();

                candidates.sort_by_key(|(marker_rank, _, _)| *marker_rank);
                for (_, process_pid, command) in candidates {
                    let csrf = if opts.csrf_flag.trim().is_empty() {
                        String::new()
                    } else {
                        match ls_extract_flag(&command, &opts.csrf_flag) {
                            Some(c) => c,
                            None => {
                                log::warn!("[plugin:{}] CSRF token not found in process args", pid);
                                continue;
                            }
                        }
                    };

                    let extension_port = opts.port_flag.as_ref().and_then(|flag| {
                        ls_extract_flag(&command, flag).and_then(|v| v.parse::<i32>().ok())
                    });

                    let mut extra = std::collections::HashMap::new();
                    if let Some(ref flags) = opts.extra_flags {
                        for flag in flags {
                            if let Some(val) = ls_extract_flag(&command, flag) {
                                let key = flag.trim_start_matches('-').to_string();
                                extra.insert(key, val);
                            }
                        }
                    }

                    let ports = if let Some(lsof) = lsof_path {
                        match std::process::Command::new(lsof)
                            .args([
                                "-nP",
                                "-iTCP",
                                "-sTCP:LISTEN",
                                "-a",
                                "-p",
                                &process_pid.to_string(),
                            ])
                            .output()
                        {
                            Ok(o) if o.status.success() => {
                                ls_parse_listening_ports(&String::from_utf8_lossy(&o.stdout))
                            }
                            Ok(_) => {
                                log::warn!("[plugin:{}] lsof returned non-zero", pid);
                                Vec::new()
                            }
                            Err(e) => {
                                log::warn!("[plugin:{}] lsof failed: {}", pid, e);
                                Vec::new()
                            }
                        }
                    } else {
                        log::warn!("[plugin:{}] lsof not found", pid);
                        Vec::new()
                    };

                    if ports.is_empty() && extension_port.is_none() {
                        log::warn!(
                            "[plugin:{}] no listening ports found for pid {}",
                            pid,
                            process_pid
                        );
                        continue;
                    }

                    log::info!(
                        "[plugin:{}] LS found: pid={}, ports={:?}, csrf=[REDACTED]",
                        pid,
                        process_pid,
                        ports
                    );

                    let result = LsDiscoverResult {
                        pid: process_pid,
                        csrf,
                        ports,
                        extra,
                        extension_port,
                    };

                    return serde_json::to_string(&result).map_err(|e| {
                        Exception::throw_message(&ctx_inner, &format!("serialize failed: {}", e))
                    });
                }

                Ok("null".to_string())
            },
        )?,
    )?;

    host.set("ls", ls_obj)?;
    Ok(())
}

pub fn patch_ls_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.ls._discoverRaw;
            __openusage_ctx.host.ls.discover = function(opts) {
                var optsJson;
                try { optsJson = JSON.stringify(opts); } catch (e) { return null; }
                var json = rawFn(optsJson);
                if (json === "null") return null;
                return JSON.parse(json);
            };
        })();
        "#
        .as_bytes(),
    )
}

/// Extract value of a CLI flag from a command string.
/// Handles both `--flag value` and `--flag=value` forms.
fn ls_extract_flag(command: &str, flag: &str) -> Option<String> {
    let parts: Vec<&str> = command.split_whitespace().collect();
    let flag_eq = format!("{}=", flag);
    for (i, part) in parts.iter().enumerate() {
        if *part == flag {
            if i + 1 < parts.len() {
                return Some(parts[i + 1].to_string());
            }
        } else if part.starts_with(&flag_eq) {
            return Some(part[flag_eq.len()..].to_string());
        }
    }
    None
}

fn ls_marker_rank(command: &str, markers_lower: &[String]) -> Option<u8> {
    if markers_lower.is_empty() {
        return Some(0);
    }

    let ide_name = ls_extract_flag(command, "--ide_name").map(|v| v.to_lowercase());
    let app_data = ls_extract_flag(command, "--app_data_dir").map(|v| v.to_lowercase());
    if ide_name.is_some() || app_data.is_some() {
        return markers_lower
            .iter()
            .any(|m| {
                ide_name.as_ref().is_some_and(|name| name == m)
                    || app_data.as_ref().is_some_and(|dir| dir == m)
            })
            .then_some(0);
    }

    let command_lower = command.to_lowercase();
    markers_lower
        .iter()
        .any(|m| command_lower.contains(&format!("/{}/", m)))
        .then_some(1)
}

fn ls_argv0(command: &str) -> &str {
    let trimmed = command.trim_start();
    let Some(quote) = trimmed.chars().next().filter(|c| *c == '"' || *c == '\'') else {
        return trimmed.split_whitespace().next().unwrap_or_default();
    };

    let quote_len = quote.len_utf8();
    let rest = &trimmed[quote_len..];
    match rest.find(quote) {
        Some(end) => &rest[..end],
        None => trimmed.split_whitespace().next().unwrap_or_default(),
    }
}

fn ls_command_matches_process(command: &str, process_name_lower: &str) -> bool {
    if process_name_lower.is_empty() {
        return false;
    }

    let argv0 = ls_argv0(command);
    let exe_name = Path::new(argv0)
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.to_lowercase())
        .unwrap_or_default();

    if exe_name == process_name_lower {
        return true;
    }

    if process_name_lower.len() >= 8 {
        exe_name.starts_with(&format!("{}_", process_name_lower))
            || command.to_lowercase().contains(process_name_lower)
    } else {
        let command_lower = command.to_lowercase();
        command_lower.ends_with(&format!("/{}", process_name_lower))
            || command_lower.contains(&format!("/{} ", process_name_lower))
            || command_lower.contains(&format!("/{}\t", process_name_lower))
    }
}

/// Parse listening port numbers from `lsof -nP -iTCP -sTCP:LISTEN` output.
fn ls_parse_listening_ports(output: &str) -> Vec<i32> {
    let mut ports = std::collections::BTreeSet::new();
    for line in output.lines() {
        if !line.contains("LISTEN") {
            continue;
        }
        // lsof -nP output: ... TCP 127.0.0.1:PORT (LISTEN)  or  ... TCP *:PORT
        // Scan tokens in reverse to find the address:port token.
        for token in line.split_whitespace().rev() {
            if let Some(colon_pos) = token.rfind(':') {
                let port_str = &token[colon_pos + 1..];
                if let Ok(port) = port_str.parse::<i32>() {
                    if port > 0 && port < 65536 {
                        ports.insert(port);
                        break;
                    }
                }
            }
        }
    }
    ports.into_iter().collect()
}

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CcusageQueryOpts {
    provider: Option<String>,
    since: Option<String>,
    until: Option<String>,
    home_path: Option<String>,
    claude_path: Option<String>,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq, Hash)]
enum CcusageProvider {
    Claude,
    Codex,
}

impl From<CcusageProvider> for ccusage::Provider {
    fn from(provider: CcusageProvider) -> Self {
        match provider {
            CcusageProvider::Claude => Self::Claude,
            CcusageProvider::Codex => Self::Codex,
        }
    }
}

static CCUSAGE_ACTIVE_PROVIDERS: OnceLock<Mutex<HashSet<CcusageProvider>>> = OnceLock::new();

struct CcusageQueryGuard {
    provider: CcusageProvider,
}

impl CcusageQueryGuard {
    fn acquire(provider: CcusageProvider) -> Option<Self> {
        let active = CCUSAGE_ACTIVE_PROVIDERS.get_or_init(|| Mutex::new(HashSet::new()));
        let mut active = active.lock().unwrap_or_else(|err| err.into_inner());
        if !active.insert(provider) {
            return None;
        }
        Some(Self { provider })
    }
}

impl Drop for CcusageQueryGuard {
    fn drop(&mut self) {
        let active = CCUSAGE_ACTIVE_PROVIDERS.get_or_init(|| Mutex::new(HashSet::new()));
        let mut active = active.lock().unwrap_or_else(|err| err.into_inner());
        active.remove(&self.provider);
    }
}

fn parse_ccusage_provider(value: &str) -> Option<CcusageProvider> {
    match value.trim().to_ascii_lowercase().as_str() {
        "claude" => Some(CcusageProvider::Claude),
        "codex" => Some(CcusageProvider::Codex),
        _ => None,
    }
}

fn infer_ccusage_provider(plugin_id: &str) -> Option<CcusageProvider> {
    parse_ccusage_provider(plugin_id)
}

fn resolve_ccusage_provider(opts: &CcusageQueryOpts, plugin_id: &str) -> CcusageProvider {
    opts.provider
        .as_deref()
        .and_then(parse_ccusage_provider)
        .or_else(|| infer_ccusage_provider(plugin_id))
        .unwrap_or(CcusageProvider::Claude)
}

/// Trims and discards blank strings — the shape every `CcusageQueryOpts` field
/// is normalized with before it reaches the loader.
fn non_blank(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

fn ccusage_home_override<'a>(
    opts: &'a CcusageQueryOpts,
    provider: CcusageProvider,
) -> Option<&'a str> {
    if let Some(home_path) = non_blank(opts.home_path.as_deref()) {
        return Some(home_path);
    }

    match provider {
        CcusageProvider::Claude => non_blank(opts.claude_path.as_deref()),
        CcusageProvider::Codex => None,
    }
}

fn inject_ccusage<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    plugin_id: &str,
    deadline: ProbeDeadline,
) -> rquickjs::Result<()> {
    let ccusage_obj = Object::new(ctx.clone())?;
    let pid = plugin_id.to_string();

    ccusage_obj.set(
        "_queryRaw",
        Function::new(
            ctx.clone(),
            move |_ctx_inner: Ctx<'_>, opts_json: String| -> rquickjs::Result<String> {
                Ok(run_ccusage_query(&opts_json, &pid, deadline))
            },
        )?,
    )?;

    host.set("ccusage", ccusage_obj)?;
    Ok(())
}

/// Backs `ctx.host.ccusage.query(opts)`.
///
/// Returns exactly the JSON string `patch_ccusage_wrapper` expects, and that
/// the `bunx ccusage` subprocess this replaced returned:
/// `{"status":"ok","data":<the daily JSON>}` on success, and
/// `{"status":"runner_failed"}` on any failure. `plugins/claude/plugin.js` and
/// `plugins/codex/plugin.js` are unchanged by the cutover.
///
/// The old `{"status":"no_runner"}` is gone: it meant "no bunx/npx/pnpm on
/// PATH", which cannot happen now that the loader is in-process. Both plugins
/// already treat every non-`ok` status identically, and Codex still raises
/// `no_runner` itself when `ctx.host.ccusage` is absent.
fn run_ccusage_query(opts_json: &str, plugin_id: &str, deadline: ProbeDeadline) -> String {
    fn runner_failed() -> String {
        serde_json::json!({ "status": "runner_failed" }).to_string()
    }

    let opts: CcusageQueryOpts = match serde_json::from_str(opts_json) {
        Ok(v) => v,
        Err(e) => {
            log::warn!("[plugin:{}] invalid ccusage opts JSON: {}", plugin_id, e);
            CcusageQueryOpts::default()
        }
    };
    let provider = resolve_ccusage_provider(&opts, plugin_id);

    // Bounds the load, and doubles as the "probe budget already spent" check:
    // `clamp_duration` yields `None` once the deadline has elapsed.
    let Some(timeout) = deadline.clamp_duration(CCUSAGE_TIMEOUT) else {
        log_probe_deadline_skip(plugin_id, "ccusage");
        return runner_failed();
    };

    // Bounds concurrency to one in-flight load per provider. That is what makes
    // abandoning a timed-out load safe: without it, every probe cycle would
    // start *another* full scan of the same slow directory and the threads
    // would pile up. It also keeps the pre-existing contract that a second
    // concurrent same-provider query returns `runner_failed` rather than
    // queueing. The guard is moved into the worker below, so a load that
    // outlives its timeout still holds it until it actually finishes.
    let Some(active_query) = CcusageQueryGuard::acquire(provider) else {
        log::warn!("[plugin:{}] ccusage query already running", plugin_id);
        return runner_failed();
    };

    let home = ccusage_home_override(&opts, provider).map(expand_path);
    let since = non_blank(opts.since.as_deref()).map(str::to_string);
    let until = non_blank(opts.until.as_deref()).map(str::to_string);

    log::info!("[plugin:{}] ccusage query via vendored loader", plugin_id);

    // Serve the prices we already have and refresh behind the query — the
    // loader is pinned offline, so this overlay is the only path a price newer
    // than its embedded snapshot has into a Claude or Codex cost.
    let pricing_overlay = pricing_cache::global().map(|cache| {
        cache.refresh_in_background();
        cache.overlay()
    });
    let pricing_overlay = pricing_overlay.flatten();

    // The load runs on its own thread so the probe worker can stop waiting on
    // it. An in-process loader cannot be killed the way the old subprocess's
    // process group could, so a load that blows the deadline is abandoned, not
    // cancelled: it keeps running, and drops `active_query` when it finishes.
    // The vendored home override is a thread-local set inside `query_daily`, so
    // it lands on this worker thread — not the caller's.
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _active_query = active_query;
        let result = ccusage::query_daily(
            provider.into(),
            home.as_deref().map(Path::new),
            since.as_deref(),
            until.as_deref(),
            pricing_overlay.as_deref(),
        );
        let _ = tx.send(result);
    });

    match rx.recv_timeout(timeout) {
        Ok(Ok(data)) => serde_json::json!({ "status": "ok", "data": data }).to_string(),
        Ok(Err(e)) => {
            log::warn!(
                "[plugin:{}] ccusage query failed: {}",
                plugin_id,
                redact_log_message(&e)
            );
            runner_failed()
        }
        Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
            log::warn!(
                "[plugin:{}] ccusage query timed out after {:?}; abandoning the load",
                plugin_id,
                timeout
            );
            runner_failed()
        }
        Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
            log::warn!("[plugin:{}] ccusage loader panicked", plugin_id);
            runner_failed()
        }
    }
}

pub fn patch_ccusage_wrapper(ctx: &rquickjs::Ctx<'_>) -> rquickjs::Result<()> {
    ctx.eval::<(), _>(
        r#"
        (function() {
            var rawFn = __openusage_ctx.host.ccusage._queryRaw;
            __openusage_ctx.host.ccusage.query = function(opts) {
                var result = rawFn(JSON.stringify(opts || {}));
                try {
                    var parsed = JSON.parse(result);
                    if (parsed && typeof parsed === "object" && typeof parsed.status === "string") {
                        return parsed;
                    }
                } catch (e) {}
                return { status: "runner_failed" };
            };
        })();
        "#
        .as_bytes(),
    )
}

fn inject_keychain<'js>(
    ctx: &Ctx<'js>,
    host: &Object<'js>,
    plugin_id: &str,
) -> rquickjs::Result<()> {
    let keychain_obj = Object::new(ctx.clone())?;
    let pid_read = plugin_id.to_string();

    keychain_obj.set(
        "readGenericPassword",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>,
                  service: String,
                  account_args: Rest<Option<String>>|
                  -> rquickjs::Result<String> {
                if !cfg!(target_os = "macos") {
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        "keychain API is only supported on macOS",
                    ));
                }
                let account = account_args
                    .0
                    .into_iter()
                    .next()
                    .flatten()
                    .and_then(|value| {
                        let trimmed = value.trim();
                        if trimmed.is_empty() {
                            None
                        } else {
                            Some(trimmed.to_string())
                        }
                    });
                let redacted_account = account.as_ref().map(|value| redact_value(value));
                if let Some(ref redacted) = redacted_account {
                    log::info!(
                        "[plugin:{}] keychain read: service={}, account={}",
                        pid_read,
                        service,
                        redacted
                    );
                } else {
                    log::info!("[plugin:{}] keychain read: service={}", pid_read, service);
                }
                let args = if let Some(ref account) = account {
                    keychain_find_generic_password_args_for_account(&service, account)
                } else {
                    keychain_find_generic_password_args(&service)
                };
                let output = std::process::Command::new("security")
                    .args(args)
                    .output()
                    .map_err(|e| {
                        Exception::throw_message(
                            &ctx_inner,
                            &format!("keychain read failed: {}", e),
                        )
                    })?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let first_line = stderr.lines().next().unwrap_or("").trim();
                    if let Some(ref redacted) = redacted_account {
                        log::warn!(
                            "[plugin:{}] keychain read miss: service={}, account={}, error={}",
                            pid_read,
                            service,
                            redacted,
                            first_line
                        );
                    } else {
                        log::warn!(
                            "[plugin:{}] keychain read miss: service={}, error={}",
                            pid_read,
                            service,
                            first_line
                        );
                    }
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        &format!("keychain item not found: {}", first_line),
                    ));
                }

                if let Some(ref redacted) = redacted_account {
                    log::info!(
                        "[plugin:{}] keychain read hit: service={}, account={}",
                        pid_read,
                        service,
                        redacted
                    );
                } else {
                    log::info!(
                        "[plugin:{}] keychain read hit: service={}",
                        pid_read,
                        service
                    );
                }
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            },
        )?,
    )?;

    let pid_read_current_user = plugin_id.to_string();
    keychain_obj.set(
        "readGenericPasswordForCurrentUser",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, service: String| -> rquickjs::Result<String> {
                if !cfg!(target_os = "macos") {
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        "keychain API is only supported on macOS",
                    ));
                }
                let account = current_macos_keychain_account();
                let args = keychain_find_generic_password_args_for_account(&service, &account);
                let redacted_account = redact_value(&account);
                log::info!(
                    "[plugin:{}] keychain read: service={}, account={}",
                    pid_read_current_user,
                    service,
                    redacted_account
                );
                let output = std::process::Command::new("security")
                    .args(&args)
                    .output()
                    .map_err(|e| {
                        Exception::throw_message(
                            &ctx_inner,
                            &format!("keychain read failed: {}", e),
                        )
                    })?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let first_line = stderr.lines().next().unwrap_or("").trim();
                    log::warn!(
                        "[plugin:{}] keychain read miss: service={}, account={}, error={}",
                        pid_read_current_user,
                        service,
                        redacted_account,
                        first_line
                    );
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        &format!("keychain item not found: {}", first_line),
                    ));
                }

                log::info!(
                    "[plugin:{}] keychain read hit: service={}, account={}",
                    pid_read_current_user,
                    service,
                    redacted_account
                );
                Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
            },
        )?,
    )?;

    let pid_write = plugin_id.to_string();
    keychain_obj.set(
        "writeGenericPassword",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, service: String, value: String| -> rquickjs::Result<()> {
                if !cfg!(target_os = "macos") {
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        "keychain API is only supported on macOS",
                    ));
                }
                log::info!("[plugin:{}] keychain write: service={}", pid_write, service);

                let mut account_arg: Option<String> = None;
                let find_output = std::process::Command::new("security")
                    .args(["find-generic-password", "-s", &service])
                    .output();

                if let Ok(output) = find_output {
                    if output.status.success() {
                        let stdout = String::from_utf8_lossy(&output.stdout);
                        for line in stdout.lines() {
                            if let Some(start) = line.find("\"acct\"<blob>=\"") {
                                let rest = &line[start + 14..];
                                if let Some(end) = rest.find('"') {
                                    account_arg = Some(rest[..end].to_string());
                                    break;
                                }
                            }
                        }
                    }
                }

                let output = if let Some(ref acct) = account_arg {
                    std::process::Command::new("security")
                        .args(keychain_add_generic_password_args_for_account(
                            &service, acct, &value,
                        ))
                        .output()
                } else {
                    std::process::Command::new("security")
                        .args(keychain_add_generic_password_args(&service, &value))
                        .output()
                }
                .map_err(|e| {
                    Exception::throw_message(&ctx_inner, &format!("keychain write failed: {}", e))
                })?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let first_line = stderr.lines().next().unwrap_or("").trim();
                    log::warn!(
                        "[plugin:{}] keychain write failed: service={}, error={}",
                        pid_write,
                        service,
                        first_line
                    );
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        &format!("keychain write failed: {}", first_line),
                    ));
                }

                log::info!(
                    "[plugin:{}] keychain write succeeded: service={}",
                    pid_write,
                    service
                );
                Ok(())
            },
        )?,
    )?;

    let pid_write_current_user = plugin_id.to_string();
    keychain_obj.set(
        "writeGenericPasswordForCurrentUser",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, service: String, value: String| -> rquickjs::Result<()> {
                if !cfg!(target_os = "macos") {
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        "keychain API is only supported on macOS",
                    ));
                }
                let account = current_macos_keychain_account();
                let args =
                    keychain_add_generic_password_args_for_account(&service, &account, &value);
                let redacted_account = redact_value(&account);
                log::info!(
                    "[plugin:{}] keychain write: service={}, account={}",
                    pid_write_current_user,
                    service,
                    redacted_account
                );
                let output = std::process::Command::new("security")
                    .args(&args)
                    .output()
                    .map_err(|e| {
                        Exception::throw_message(
                            &ctx_inner,
                            &format!("keychain write failed: {}", e),
                        )
                    })?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    let first_line = stderr.lines().next().unwrap_or("").trim();
                    log::warn!(
                        "[plugin:{}] keychain write failed: service={}, account={}, error={}",
                        pid_write_current_user,
                        service,
                        redacted_account,
                        first_line
                    );
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        &format!("keychain write failed: {}", first_line),
                    ));
                }

                log::info!(
                    "[plugin:{}] keychain write succeeded: service={}, account={}",
                    pid_write_current_user,
                    service,
                    redacted_account
                );
                Ok(())
            },
        )?,
    )?;

    host.set("keychain", keychain_obj)?;
    Ok(())
}

fn inject_sqlite<'js>(ctx: &Ctx<'js>, host: &Object<'js>) -> rquickjs::Result<()> {
    let sqlite_obj = Object::new(ctx.clone())?;

    sqlite_obj.set(
        "query",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, db_path: String, sql: String| -> rquickjs::Result<String> {
                if sql.lines().any(|line| line.trim_start().starts_with('.')) {
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        "sqlite3 dot-commands are not allowed",
                    ));
                }
                let expanded = expand_path(&db_path);

                // Prefer a normal read-only open so WAL contents are visible (common for app state DBs).
                // Fall back to immutable=1 to bypass WAL/SHM lock issues after macOS sleep.
                let primary = std::process::Command::new("sqlite3")
                    .args(["-readonly", "-json", &expanded, &sql])
                    .output()
                    .map_err(|e| {
                        Exception::throw_message(&ctx_inner, &format!("sqlite3 exec failed: {}", e))
                    })?;

                if primary.status.success() {
                    return Ok(String::from_utf8_lossy(&primary.stdout).to_string());
                }

                // Percent-encode special chars for valid URI (% must be first!)
                let encoded = expanded
                    .replace('%', "%25")
                    .replace(' ', "%20")
                    .replace('#', "%23")
                    .replace('?', "%3F");
                let uri_path = format!("file:{}?immutable=1", encoded);
                let fallback = std::process::Command::new("sqlite3")
                    .args(["-readonly", "-json", &uri_path, &sql])
                    .output()
                    .map_err(|e| {
                        Exception::throw_message(&ctx_inner, &format!("sqlite3 exec failed: {}", e))
                    })?;

                if !fallback.status.success() {
                    let stderr_primary = String::from_utf8_lossy(&primary.stderr);
                    let stderr_fallback = String::from_utf8_lossy(&fallback.stderr);
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        &format!(
                            "sqlite3 error: {} (fallback: {})",
                            stderr_primary.trim(),
                            stderr_fallback.trim()
                        ),
                    ));
                }

                Ok(String::from_utf8_lossy(&fallback.stdout).to_string())
            },
        )?,
    )?;

    sqlite_obj.set(
        "exec",
        Function::new(
            ctx.clone(),
            move |ctx_inner: Ctx<'_>, db_path: String, sql: String| -> rquickjs::Result<()> {
                if sql.lines().any(|line| line.trim_start().starts_with('.')) {
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        "sqlite3 dot-commands are not allowed",
                    ));
                }
                let expanded = expand_path(&db_path);
                let output = std::process::Command::new("sqlite3")
                    .args([&expanded, &sql])
                    .output()
                    .map_err(|e| {
                        Exception::throw_message(&ctx_inner, &format!("sqlite3 exec failed: {}", e))
                    })?;

                if !output.status.success() {
                    let stderr = String::from_utf8_lossy(&output.stderr);
                    return Err(Exception::throw_message(
                        &ctx_inner,
                        &format!("sqlite3 error: {}", stderr.trim()),
                    ));
                }

                Ok(())
            },
        )?,
    )?;

    host.set("sqlite", sqlite_obj)?;
    Ok(())
}

fn iso_now() -> String {
    time::OffsetDateTime::now_utc()
        .format(&time::format_description::well_known::Rfc3339)
        .unwrap_or_else(|err| {
            log::error!("nowIso format failed: {}", err);
            "1970-01-01T00:00:00Z".to_string()
        })
}

fn expand_path(path: &str) -> String {
    if path == "~" {
        if let Some(home) = dirs::home_dir() {
            return home.to_string_lossy().to_string();
        }
    }
    if path.starts_with("~/") {
        if let Some(home) = dirs::home_dir() {
            return home.join(&path[2..]).to_string_lossy().to_string();
        }
    }
    path.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rquickjs::{Context, Function, Object, Runtime};

    fn encrypt_aes_256_gcm_envelope_for_test(key: &[u8], plaintext: &str) -> String {
        let iv = [7_u8; 16];
        type Aes256Gcm16 = AesGcm<Aes256, U16>;
        let cipher = Aes256Gcm16::new_from_slice(key).expect("encrypt init");
        let nonce = Nonce::<U16>::from_slice(&iv);
        let ciphertext_and_tag = cipher
            .encrypt(nonce, plaintext.as_bytes())
            .expect("encrypt finalize");
        let split_at = ciphertext_and_tag.len() - 16;
        let (ciphertext, tag) = ciphertext_and_tag.split_at(split_at);

        format!(
            "{}:{}:{}",
            BASE64_STANDARD.encode(iv),
            BASE64_STANDARD.encode(tag),
            BASE64_STANDARD.encode(ciphertext)
        )
    }

    fn node_generated_aes_256_gcm_vector_for_test() -> (&'static str, &'static str, &'static str) {
        (
            "CwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCwsLCws=",
            "BwcHBwcHBwcHBwcHBwcHBw==:yFbCs4LOJ0aj9NPNf5pfVA==:7PKjtOdATLClvaWrMw0b0M8Nov4KPhxwQX4hdczqQlcZi9Zhi6DjAoK+WolvMwuhPIk=",
            r#"{"access_token":"token","refresh_token":"refresh"}"#,
        )
    }

    #[test]
    fn last_non_empty_trimmed_line_uses_final_value_when_stdout_is_noisy() {
        let stdout = "banner line\nanother message\n  sk-test-key-12345  \n";
        let value = last_non_empty_trimmed_line(stdout);
        assert_eq!(value.as_deref(), Some("sk-test-key-12345"));
    }

    #[test]
    fn last_non_empty_trimmed_line_returns_none_for_empty_stdout() {
        let stdout = "  \n\n\t\n";
        let value = last_non_empty_trimmed_line(stdout);
        assert!(value.is_none());
    }

    #[test]
    fn decrypt_aes_256_gcm_envelope_round_trips_plaintext() {
        let key = [11_u8; 32];
        let key_b64 = BASE64_STANDARD.encode(key);
        let plaintext = r#"{"access_token":"token","refresh_token":"refresh"}"#;
        let envelope = encrypt_aes_256_gcm_envelope_for_test(&key, plaintext);

        let decrypted =
            decrypt_aes_256_gcm_envelope(&envelope, &key_b64).expect("decrypt envelope");

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn encrypt_aes_256_gcm_envelope_round_trips_plaintext() {
        let key = [21_u8; 32];
        let key_b64 = BASE64_STANDARD.encode(key);
        let plaintext = r#"{"access_token":"token-2","refresh_token":"refresh-2"}"#;

        let envelope = encrypt_aes_256_gcm_envelope(plaintext, &key_b64).expect("encrypt envelope");
        let decrypted =
            decrypt_aes_256_gcm_envelope(&envelope, &key_b64).expect("decrypt envelope");

        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn decrypt_aes_256_gcm_envelope_rejects_invalid_component_lengths() {
        let key_b64 = BASE64_STANDARD.encode([9_u8; 32]);
        let short_key_b64 = BASE64_STANDARD.encode([7_u8; 31]);
        let iv_b64 = BASE64_STANDARD.encode([1_u8; 15]);
        let tag_b64 = BASE64_STANDARD.encode([2_u8; 16]);
        let ciphertext_b64 = BASE64_STANDARD.encode([3_u8; 8]);

        let key_err =
            decrypt_aes_256_gcm_envelope("AQ==:AQ==:AQ==", &short_key_b64).expect_err("key length");
        assert!(key_err.contains("expected 32 bytes"));

        let iv_err = decrypt_aes_256_gcm_envelope(
            &format!("{}:{}:{}", iv_b64, tag_b64, ciphertext_b64),
            &key_b64,
        )
        .expect_err("iv length");
        assert!(iv_err.contains("iv length"));

        let short_tag_b64 = BASE64_STANDARD.encode([2_u8; 15]);
        let tag_err = decrypt_aes_256_gcm_envelope(
            &format!(
                "{}:{}:{}",
                BASE64_STANDARD.encode([1_u8; 16]),
                short_tag_b64,
                ciphertext_b64
            ),
            &key_b64,
        )
        .expect_err("tag length");
        assert!(tag_err.contains("auth tag length"));
    }

    #[test]
    fn sanitize_env_value_strips_ansi_and_control_sequences() {
        let raw = "\u{1b}[?1000l\n  sk-test-key-12345\u{1b}[?2004h\r\n";
        let value = sanitize_env_value(raw);
        assert_eq!(value.as_deref(), Some("sk-test-key-12345"));
    }

    #[test]
    fn extract_marked_value_ignores_noisy_shell_output() {
        let stdout = concat!(
            "startup banner\n",
            "\u{1b}[31mplugin failed\u{1b}[0m\n",
            "__OPENUSAGE_ENV_START__\n",
            "  sk-test-key-12345  \n",
            "__OPENUSAGE_ENV_END__\n",
            "\u{1b}[32muser@host\u{1b}[0m\n"
        );
        let value =
            extract_marked_value(stdout, "__OPENUSAGE_ENV_START__", "__OPENUSAGE_ENV_END__");
        assert_eq!(value.as_deref(), Some("sk-test-key-12345"));
    }

    #[test]
    fn extract_marked_value_strips_inline_terminal_sequences_from_marked_value() {
        let stdout = concat!(
            "__OPENUSAGE_ENV_START__\n",
            "\u{1b}[?1000l\n",
            "  sk-test-key-12345\u{1b}[?2004h\r\n",
            "__OPENUSAGE_ENV_END__\n"
        );
        let value =
            extract_marked_value(stdout, "__OPENUSAGE_ENV_START__", "__OPENUSAGE_ENV_END__");
        assert_eq!(value.as_deref(), Some("sk-test-key-12345"));
    }

    #[test]
    fn extract_marked_value_returns_none_when_marked_value_is_empty() {
        let stdout = "__OPENUSAGE_ENV_START__\n  \n__OPENUSAGE_ENV_END__\n";
        let value =
            extract_marked_value(stdout, "__OPENUSAGE_ENV_START__", "__OPENUSAGE_ENV_END__");
        assert!(value.is_none());
    }

    #[test]
    fn parse_interactive_shell_env_output_does_not_fallback_to_end_marker_for_empty_value() {
        let stdout = "__OPENUSAGE_ENV_START__\n  \n__OPENUSAGE_ENV_END__\n";
        let value = parse_interactive_shell_env_output(
            stdout,
            "__OPENUSAGE_ENV_START__",
            "__OPENUSAGE_ENV_END__",
        );
        assert!(value.is_none());
    }

    #[test]
    fn parse_interactive_shell_env_output_falls_back_without_markers() {
        let stdout = "\u{1b}[?1000l\n  sk-test-key-12345\u{1b}[?2004h\r\n";
        let value = parse_interactive_shell_env_output(
            stdout,
            "__OPENUSAGE_ENV_START__",
            "__OPENUSAGE_ENV_END__",
        );
        assert_eq!(value.as_deref(), Some("sk-test-key-12345"));
    }

    #[test]
    fn crypto_api_exposes_decrypt() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", &app_data, "0.0.0").expect("inject host api");
            let globals = ctx.globals();
            let probe_ctx: Object = globals.get("__openusage_ctx").expect("probe ctx");
            let host: Object = probe_ctx.get("host").expect("host");
            let crypto: Object = host.get("crypto").expect("crypto");
            let _decrypt: Function = crypto.get("decryptAes256Gcm").expect("decryptAes256Gcm");
            let _encrypt: Function = crypto.get("encryptAes256Gcm").expect("encryptAes256Gcm");
        });
    }

    #[test]
    fn crypto_api_decrypts_node_generated_envelope_from_js() {
        let (key_b64, envelope, expected_plaintext) = node_generated_aes_256_gcm_vector_for_test();
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", &app_data, "0.0.0").expect("inject host api");
            let js_expr = format!(
                r#"__openusage_ctx.host.crypto.decryptAes256Gcm("{}", "{}")"#,
                envelope, key_b64
            );
            let decrypted: String = ctx.eval(js_expr).expect("js decrypt");
            assert_eq!(decrypted, expected_plaintext);
        });
    }

    #[test]
    fn crypto_api_exposes_sha256_hex() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", &app_data, "0.0.0").expect("inject host api");
            // Vector: `printf '%s' 'hello' | shasum -a 256`
            let result: String = ctx
                .eval(r#"__openusage_ctx.host.crypto.sha256Hex("hello")"#)
                .expect("js sha256");
            assert_eq!(
                result,
                "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
            );

            let empty: String = ctx
                .eval(r#"__openusage_ctx.host.crypto.sha256Hex("")"#)
                .expect("js sha256 empty");
            assert_eq!(
                empty,
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
            );
        });
    }

    #[test]
    fn keychain_api_exposes_write_variants() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", &app_data, "0.0.0").expect("inject host api");
            let globals = ctx.globals();
            let probe_ctx: Object = globals.get("__openusage_ctx").expect("probe ctx");
            let host: Object = probe_ctx.get("host").expect("host");
            let keychain: Object = host.get("keychain").expect("keychain");
            let _read: Function = keychain
                .get("readGenericPassword")
                .expect("readGenericPassword");
            let _read_current_user: Function = keychain
                .get("readGenericPasswordForCurrentUser")
                .expect("readGenericPasswordForCurrentUser");
            let _write: Function = keychain
                .get("writeGenericPassword")
                .expect("writeGenericPassword");
            let _write_current_user: Function = keychain
                .get("writeGenericPasswordForCurrentUser")
                .expect("writeGenericPasswordForCurrentUser");
        });
    }

    #[test]
    fn keychain_read_generic_password_accepts_optional_account_arg_from_js() {
        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", &app_data, "0.0.0").expect("inject host api");

            let message: String = ctx
                .eval(
                    r#"
                    try {
                        __openusage_ctx.host.keychain.readGenericPassword("__openusage_missing_service__");
                        "ok";
                    } catch (e) {
                        String(e);
                    }
                    "#,
                )
                .expect("js eval");

            assert!(
                !message.contains("2 where expected"),
                "single-arg call should reach the keychain implementation, got: {}",
                message
            );
        });
    }

    #[test]
    fn ls_command_matches_language_server_variants() {
        assert!(ls_command_matches_process(
            "/Applications/Antigravity IDE.app/Contents/Resources/language_server_macos_arm --app_data_dir antigravity-ide",
            "language_server"
        ));
        assert!(ls_command_matches_process(
            "/tmp/language_server --app_data_dir antigravity-ide",
            "language_server"
        ));
    }

    #[test]
    fn ls_command_matches_short_process_names_exactly() {
        assert!(ls_command_matches_process(
            "/opt/homebrew/bin/agy --some-flag",
            "agy"
        ));
        assert!(ls_command_matches_process(
            "/Applications/Antigravity IDE.app/Contents/Resources/agy --some-flag",
            "agy"
        ));
        assert!(ls_command_matches_process(
            "\"/Applications/Antigravity IDE.app/Contents/Resources/agy\" --some-flag",
            "agy"
        ));
        assert!(!ls_command_matches_process(
            "/opt/homebrew/bin/not-agy-helper --some-flag agy",
            "agy"
        ));
    }

    #[test]
    fn ls_marker_rank_prefers_exact_flags_over_path_fallback() {
        let markers = vec!["antigravity".to_string()];

        assert_eq!(
            ls_marker_rank(
                "/tmp/windsurf/language_server --ide_name antigravity",
                &markers
            ),
            Some(0)
        );
        assert_eq!(
            ls_marker_rank("/tmp/antigravity/language_server", &markers),
            Some(1)
        );
        assert_eq!(
            ls_marker_rank(
                "/tmp/antigravity/language_server --ide_name windsurf",
                &markers
            ),
            None
        );
    }

    #[test]
    fn env_api_respects_allowlist_in_host_and_js() {
        let claude_env_vars = [
            "CLAUDE_CONFIG_DIR",
            "CLAUDE_CODE_OAUTH_TOKEN",
            "USER_TYPE",
            "USE_STAGING_OAUTH",
            "USE_LOCAL_OAUTH",
            "CLAUDE_CODE_CUSTOM_OAUTH_URL",
            "CLAUDE_CODE_OAUTH_CLIENT_ID",
            "CLAUDE_LOCAL_OAUTH_API_BASE",
        ];

        for name in claude_env_vars {
            assert!(
                WHITELISTED_ENV_VARS.contains(&name),
                "{name} must be whitelisted for Claude auth compatibility"
            );
        }

        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", &app_data, "0.0.0").expect("inject host api");
            let globals = ctx.globals();
            let probe_ctx: Object = globals.get("__openusage_ctx").expect("probe ctx");
            let host: Object = probe_ctx.get("host").expect("host");
            let env: Object = host.get("env").expect("env");
            let get: Function = env.get("get").expect("get");

            for name in WHITELISTED_ENV_VARS {
                let expected = resolve_env_value(name);
                let value: Option<String> =
                    get.call((name.to_string(),)).expect("get whitelisted var");
                assert_eq!(value, expected, "{name} should match host env resolver");

                let js_expr = format!(r#"__openusage_ctx.host.env.get("{}")"#, name);
                let js_value: Option<String> = ctx.eval(js_expr).expect("js get whitelisted var");
                assert_eq!(
                    js_value, expected,
                    "{name} should match host env resolver from JS"
                );
            }

            let blocked: Option<String> = get
                .call(("__OPENUSAGE_TEST_NOT_WHITELISTED__".to_string(),))
                .expect("get blocked var");
            assert!(
                blocked.is_none(),
                "non-whitelisted vars must not be exposed"
            );

            let js_blocked: Option<String> = ctx
                .eval(r#"__openusage_ctx.host.env.get("__OPENUSAGE_TEST_NOT_WHITELISTED__")"#)
                .expect("js get blocked var");
            assert!(
                js_blocked.is_none(),
                "non-whitelisted vars must not be exposed from JS"
            );
        });
    }

    #[test]
    fn env_api_prefers_process_env() {
        struct RestoreEnvVar {
            name: &'static str,
            old: Option<String>,
        }

        impl Drop for RestoreEnvVar {
            fn drop(&mut self) {
                if let Some(value) = self.old.take() {
                    // SAFETY: tests serialize env changes via this guard; value is restored on drop.
                    unsafe { std::env::set_var(self.name, value) };
                } else {
                    // SAFETY: tests serialize env changes via this guard; var is restored/removed on drop.
                    unsafe { std::env::remove_var(self.name) };
                }
            }
        }

        let name = "ZAI_API_KEY";
        let old = std::env::var(name).ok();
        let _restore = RestoreEnvVar { name, old };
        // SAFETY: this test restores the previous value in `Drop`.
        unsafe { std::env::set_var(name, "sk-process-env-test-1234567890") };

        let rt = Runtime::new().expect("runtime");
        let ctx = Context::full(&rt).expect("context");
        ctx.with(|ctx| {
            let app_data = std::env::temp_dir();
            inject_host_api(&ctx, "test", &app_data, "0.0.0").expect("inject host api");
            let globals = ctx.globals();
            let probe_ctx: Object = globals.get("__openusage_ctx").expect("probe ctx");
            let host: Object = probe_ctx.get("host").expect("host");
            let env: Object = host.get("env").expect("env");
            let get: Function = env.get("get").expect("get");

            let value: Option<String> = get.call((name.to_string(),)).expect("get");
            assert_eq!(
                value.as_deref(),
                Some("sk-process-env-test-1234567890"),
                "process env should be preferred over shell lookup"
            );

            let js_value: Option<String> = ctx
                .eval(r#"__openusage_ctx.host.env.get("ZAI_API_KEY")"#)
                .expect("js get");
            assert_eq!(
                js_value.as_deref(),
                Some("sk-process-env-test-1234567890"),
                "process env should be preferred from JS"
            );
        });
    }

    #[test]
    fn current_macos_keychain_account_prefers_explicit_user_value() {
        assert_eq!(
            current_macos_keychain_account_from_user_env(Some("usagepal-test-user".to_string())),
            "usagepal-test-user"
        );
    }

    #[test]
    fn expand_path_expands_tilde_prefix() {
        let home = dirs::home_dir().expect("home dir");
        let expected = home.join(".claude-custom").to_string_lossy().to_string();

        assert_eq!(expand_path("~/.claude-custom"), expected);
    }

    #[test]
    fn keychain_find_generic_password_args_include_service_only_lookup() {
        let args = keychain_find_generic_password_args("Claude Code-credentials");
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();

        assert_eq!(
            rendered,
            vec![
                "find-generic-password",
                "-s",
                "Claude Code-credentials",
                "-w",
            ]
        );
    }

    #[test]
    fn keychain_find_generic_password_args_for_account_include_account_and_service() {
        let args = keychain_find_generic_password_args_for_account(
            "Claude Code-credentials",
            "usagepal-test-user",
        );
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();

        assert_eq!(
            rendered,
            vec![
                "find-generic-password",
                "-a",
                "usagepal-test-user",
                "-s",
                "Claude Code-credentials",
                "-w",
            ]
        );
    }

    #[test]
    fn keychain_add_generic_password_args_include_service_only_write() {
        let args = keychain_add_generic_password_args("Claude Code-credentials", "secret-value");
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();

        assert_eq!(
            rendered,
            vec![
                "add-generic-password",
                "-U",
                "-s",
                "Claude Code-credentials",
                "-w",
                "secret-value",
            ]
        );
    }

    #[test]
    fn keychain_add_generic_password_args_for_account_include_update_account_service_and_value() {
        let args = keychain_add_generic_password_args_for_account(
            "Claude Code-credentials",
            "usagepal-test-user",
            "secret-value",
        );
        let rendered: Vec<String> = args
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect();

        assert_eq!(
            rendered,
            vec![
                "add-generic-password",
                "-U",
                "-a",
                "usagepal-test-user",
                "-s",
                "Claude Code-credentials",
                "-w",
                "secret-value",
            ]
        );
    }

    #[test]
    fn redact_value_shows_first_and_last_four() {
        assert_eq!(redact_value("sk-1234567890abcdef"), "sk-1...cdef");
        assert_eq!(redact_value("short"), "[REDACTED]");
    }

    #[test]
    fn redact_url_redacts_api_key_param() {
        let url = "https://api.example.com/v1?api_key=sk-1234567890abcdef&other=value";
        let redacted = redact_url(url);
        assert!(redacted.contains("api_key=sk-1...cdef"));
        assert!(redacted.contains("other=value"));
    }

    #[test]
    fn redact_url_redacts_user_query_param() {
        let url = "https://cursor.com/api/usage?user=user_abcdefghijklmnopqrstuvwxyz&limit=10";
        let redacted = redact_url(url);
        assert!(
            redacted.contains("user=user...wxyz"),
            "user query param should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("limit=10"),
            "non-sensitive params should be preserved, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_url_preserves_non_sensitive_params() {
        let url = "https://api.example.com/v1?limit=10&offset=20";
        assert_eq!(redact_url(url), url);
    }

    #[test]
    fn redact_url_redacts_profile_arn_query_param() {
        let url = "https://q.us-east-1.amazonaws.com/getUsageLimits?profileArn=arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK&origin=AI_EDITOR";
        let redacted = redact_url(url);
        assert!(
            !redacted.contains("699475941385"),
            "profileArn should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("origin=AI_EDITOR"),
            "non-sensitive params should remain visible, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_jwt() {
        let body = r#"{"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"}"#;
        let redacted = redact_body(body);
        // JWT gets redacted to first4...last4 format
        assert!(
            !redacted.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"),
            "full JWT should be redacted, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_api_keys() {
        let body = r#"{"key": "sk-1234567890abcdefghij"}"#;
        let redacted = redact_body(body);
        assert!(redacted.contains("sk-1...ghij"));
    }

    #[test]
    fn redact_body_redacts_devin_session_token() {
        let body = r#"metadata apiKey=devin-session-token$abcdefghijklmnopqrstuvwxyz123456"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("devin-session-token$abcdefghijklmnopqrstuvwxyz123456"),
            "Devin session token should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("devi...3456"),
            "Devin session token should use first4...last4 redaction, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_json_password_field() {
        let body = r#"{"password": "supersecretpassword123"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("supersecretpassword123"),
            "password should be redacted, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_user_id_and_email() {
        let body = r#"{"user_id": "user-iupzZ7KFykMLrnzpkHSq7wjo", "email": "rob@sunstory.com"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("user-iupzZ7KFykMLrnzpkHSq7wjo"),
            "user_id should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("rob@sunstory.com"),
            "email should be redacted, got: {}",
            redacted
        );
        // Should show first4...last4
        assert!(
            redacted.contains("user...7wjo"),
            "user_id should show first4...last4, got: {}",
            redacted
        );
        assert!(
            redacted.contains("rob@....com"),
            "email should show first4...last4, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_camel_case_user_and_account_ids() {
        let body = r#"{"userId": "user_abcdefghijklmnopqrstuvwxyz", "accountId": "acct_1234567890abcdef"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("user_abcdefghijklmnopqrstuvwxyz"),
            "userId should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("acct_1234567890abcdef"),
            "accountId should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("user...wxyz"),
            "userId should show first4...last4, got: {}",
            redacted
        );
        assert!(
            redacted.contains("acct...cdef"),
            "accountId should show first4...last4, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_devin_org_and_account_display_name() {
        let body = r#"{"orgId":"org-6b6e9de248db472bb25b296599ea3dc0","accountDisplayName":"rob@sunstory.com","devinInfo":{"org_id":"org-abcdef1234567890","account_display_name":"team@example.com"}}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("org-6b6e9de248db472bb25b296599ea3dc0"),
            "orgId should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("rob@sunstory.com"),
            "accountDisplayName should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("org-abcdef1234567890"),
            "org_id should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("team@example.com"),
            "account_display_name should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("org-...3dc0"),
            "orgId should show first4...last4, got: {}",
            redacted
        );
        assert!(
            redacted.contains("rob@....com"),
            "accountDisplayName should show first4...last4, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_team_id_payment_id_and_paths() {
        let body = r#"{"teamId":"cc1ac023-9ff5-4c1f-a5a4-ae2a82df4243","paymentId":"cus_S5m1PGxjLWoc1c","binaryPath":"/opt/homebrew/bin/bunx","homePath":"/Users/rebers/.claude"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("cc1ac023-9ff5-4c1f-a5a4-ae2a82df4243"),
            "teamId should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("cus_S5m1PGxjLWoc1c"),
            "paymentId should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("/opt/homebrew/bin/bunx"),
            "path should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("/Users/rebers/.claude"),
            "path should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("[PATH]"),
            "expected path marker, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_profile_arn_fields() {
        let body = r#"{"profileArn":"arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK","profile_arn":"arn:aws:codewhisperer:us-east-1:699475941385:profile/EHGA3GRVQMUK"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("699475941385"),
            "profile arn should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("arn:...QMUK"),
            "profile arn should use first4...last4 redaction, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_log_message_redacts_jwt_and_api_key() {
        let msg = "token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U key=sk-1234567890abcdef";
        let redacted = redact_log_message(msg);
        assert!(
            !redacted.contains("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"),
            "JWT should be redacted"
        );
        assert!(
            !redacted.contains("sk-1234567890abcdef"),
            "API key should be redacted"
        );
    }

    #[test]
    fn redact_log_message_redacts_devin_session_token() {
        let msg = "auth=devin-session-token$abcdefghijklmnopqrstuvwxyz123456";
        let redacted = redact_log_message(msg);
        assert!(
            !redacted.contains("devin-session-token$abcdefghijklmnopqrstuvwxyz123456"),
            "Devin session token should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("devi...3456"),
            "Devin session token should use first4...last4 redaction, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_log_message_redacts_account_and_paths() {
        let msg = "keychain read: service=Claude Code-credentials, account=rebers path=/opt/homebrew/bin/bunx home=/Users/rebers/.claude";
        let redacted = redact_log_message(msg);
        assert!(
            !redacted.contains("account=rebers"),
            "account should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("/opt/homebrew/bin/bunx"),
            "path should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("/Users/rebers/.claude"),
            "path should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("account=[REDACTED]"),
            "expected redacted account, got: {}",
            redacted
        );
        assert!(
            redacted.contains("[PATH]"),
            "expected redacted path, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_login_and_analytics_tracking_id() {
        let body =
            r#"{"login":"robinebers","analytics_tracking_id":"c9df3f012bb8c2eb7aae6868ee8da6cf"}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("robinebers"),
            "login should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("c9df3f012bb8c2eb7aae6868ee8da6cf"),
            "analytics_tracking_id should be redacted, got: {}",
            redacted
        );
        // login is short (<=12 chars) so becomes [REDACTED]; analytics_tracking_id is long so first4...last4
        assert!(
            redacted.contains("[REDACTED]"),
            "login should be redacted, got: {}",
            redacted
        );
        assert!(
            redacted.contains("c9df...a6cf"),
            "analytics_tracking_id should show first4...last4, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_name_field() {
        let body =
            r#"{"userStatus":{"name":"Robin Ebers","email":"rob@sunstory.com","planStatus":{}}}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("Robin Ebers"),
            "name should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("rob@sunstory.com"),
            "email should be redacted, got: {}",
            redacted
        );
        // "Robin Ebers" is 11 chars (<=12) so becomes [REDACTED]
        assert!(
            redacted.contains("\"name\": \"[REDACTED]\""),
            "name should show [REDACTED], got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_display_name_and_subscription_id() {
        let body = r#"{"displayName":"Nicolas Demanez","subscriptionId":"sub_abc123def456","plan":{"displayName":"ClinePass"}}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("Nicolas Demanez"),
            "displayName should be redacted, got: {}",
            redacted
        );
        assert!(
            !redacted.contains("sub_abc123def456"),
            "subscriptionId should be redacted, got: {}",
            redacted
        );
        // The plan displayName "ClinePass" is 9 chars (<=12) → [REDACTED]
        assert!(
            !redacted.contains("ClinePass"),
            "plan displayName should also be redacted, got: {}",
            redacted
        );
    }

    #[test]
    fn redact_body_redacts_display_text() {
        let body = r#"{"ok":true,"result":{"displayText":"Signed in as person@example.com (nickname)\nAmp Free: 48% remaining today"}}"#;
        let redacted = redact_body(body);
        assert!(
            !redacted.contains("person@example.com") && !redacted.contains("nickname"),
            "displayText should be redacted, got: {}",
            redacted
        );
        assert!(redacted.contains("\"displayText\": \"Sign...oday\""));
    }

    #[test]
    fn resolve_ccusage_provider_prefers_explicit_opt_then_plugin_id() {
        let opts_explicit = CcusageQueryOpts {
            provider: Some("codex".to_string()),
            since: None,
            until: None,
            home_path: None,
            claude_path: None,
        };
        assert_eq!(
            resolve_ccusage_provider(&opts_explicit, "claude"),
            CcusageProvider::Codex
        );

        let opts_empty = CcusageQueryOpts::default();
        assert_eq!(
            resolve_ccusage_provider(&opts_empty, "codex"),
            CcusageProvider::Codex
        );
        assert_eq!(
            resolve_ccusage_provider(&opts_empty, "claude"),
            CcusageProvider::Claude
        );
        assert_eq!(
            resolve_ccusage_provider(&opts_empty, "unknown-provider"),
            CcusageProvider::Claude
        );
    }

    #[test]
    fn ccusage_home_override_supports_home_path_and_claude_compat() {
        let with_home = CcusageQueryOpts {
            provider: None,
            since: None,
            until: None,
            home_path: Some("/tmp/shared-home".to_string()),
            claude_path: Some("/tmp/claude-home".to_string()),
        };
        assert_eq!(
            ccusage_home_override(&with_home, CcusageProvider::Claude),
            Some("/tmp/shared-home")
        );
        assert_eq!(
            ccusage_home_override(&with_home, CcusageProvider::Codex),
            Some("/tmp/shared-home")
        );

        let claude_compat = CcusageQueryOpts {
            provider: None,
            since: None,
            until: None,
            home_path: None,
            claude_path: Some("/tmp/legacy-claude-path".to_string()),
        };
        assert_eq!(
            ccusage_home_override(&claude_compat, CcusageProvider::Claude),
            Some("/tmp/legacy-claude-path")
        );
        assert_eq!(
            ccusage_home_override(&claude_compat, CcusageProvider::Codex),
            None
        );
    }

    #[test]
    fn ccusage_query_guard_blocks_overlapping_provider_query() {
        let first = CcusageQueryGuard::acquire(CcusageProvider::Codex)
            .expect("first query should acquire guard");
        assert!(
            CcusageQueryGuard::acquire(CcusageProvider::Codex).is_none(),
            "second query for same provider should be blocked"
        );
        assert!(
            CcusageQueryGuard::acquire(CcusageProvider::Claude).is_some(),
            "different provider should have its own guard"
        );
        drop(first);
        assert!(
            CcusageQueryGuard::acquire(CcusageProvider::Codex).is_some(),
            "guard should release on drop"
        );
    }

    /// The load is bounded, and the bound is the probe's, not just the 15s
    /// ceiling: an already-spent budget must refuse the query outright rather
    /// than start an unbounded, uninterruptible scan on a probe worker.
    #[test]
    fn ccusage_query_refuses_to_start_once_the_probe_deadline_is_spent() {
        let response = run_ccusage_query("{}", "claude", ProbeDeadline::at(Instant::now()));

        assert_eq!(response, r#"{"status":"runner_failed"}"#);
    }

    #[test]
    fn probe_deadline_clamps_host_timeout_to_remaining_budget() {
        let deadline = ProbeDeadline::at(Instant::now() + Duration::from_millis(25));
        let clamped = deadline
            .clamp_duration(Duration::from_secs(10))
            .expect("remaining budget should produce a host timeout");

        assert!(
            clamped <= Duration::from_millis(25),
            "host timeout should not exceed remaining probe budget"
        );
        assert!(
            clamped >= Duration::from_millis(1),
            "host timeout should stay non-zero for blocking clients"
        );
    }

    #[test]
    fn probe_deadline_does_not_extend_elapsed_budget() {
        let deadline = ProbeDeadline::at(Instant::now());

        assert_eq!(deadline.clamp_duration(Duration::from_secs(10)), None);
    }
}
