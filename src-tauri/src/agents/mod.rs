//! Local agent session discovery for the Agents page.
//!
//! Read-only and metadata-only: we stat transcript files and read at most the
//! first line of Codex rollouts (whose `session_meta` record carries the
//! working directory), each Cursor workspace's `workspace.json` (which carries
//! the folder URI), and OpenCode's session id/directory/title/timestamps from
//! its local database. Message content is never read.

mod liveness;
mod opencode;
mod subagents;

use serde::Serialize;
use specta::Type;
use std::collections::HashSet;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// A session counts as fresh when its backing file was written inside this
/// window — streaming output counts as work even when the process tree is
/// momentarily quiet between tool calls.
const FRESH_WINDOW_SECS: u64 = 60;
/// Sessions idle longer than this are omitted so the list stays relevant.
const MAX_IDLE_SECS: u64 = 30 * 24 * 60 * 60;
const MAX_SESSIONS: usize = 50;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AgentSession {
    pub provider_id: String,
    pub provider_name: String,
    pub project_name: String,
    pub session_id: String,
    pub cwd: Option<String>,
    /// Session title when the source has one (OpenCode stores titles).
    pub title: Option<String>,
    pub subagents: Vec<subagents::SubagentInfo>,
    /// Unix-ms of the last observed file activity. f64 because specta forbids u64.
    pub last_active_ms: f64,
    /// `"active"` for a tree doing work (or streaming output), `"idle"` for a
    /// live but quiet worker, `"closed"` with no running process.
    pub status: String,
}

fn unix_now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or(0)
}

fn file_mtime_ms(path: &Path) -> Option<u128> {
    path.metadata()
        .ok()?
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|elapsed| elapsed.as_millis())
}

fn status_fresh(last_active_ms: u128, now_ms: u128) -> bool {
    now_ms.saturating_sub(last_active_ms) <= FRESH_WINDOW_SECS as u128 * 1000
}

/// A session before liveness resolution. Scans collect these; `collect_*`
/// sorts most-recent-first so process claiming favors the newest session.
struct RawSession {
    provider_id: &'static str,
    provider_name: &'static str,
    project_name: String,
    session_id: String,
    cwd: Option<String>,
    title: Option<String>,
    last_active_ms: u128,
    /// `<project>/<session-id>` dir for Claude (holds `subagents/`); else None.
    source_dir: Option<PathBuf>,
}

/// Last path component of a working directory (`/a/b/foo` → `foo`).
fn project_name_from_cwd(cwd: &str) -> String {
    let trimmed = cwd.trim_end_matches('/');
    if trimmed.is_empty() {
        return "/".to_string();
    }
    trimmed
        .rsplit('/')
        .next()
        .filter(|name| !name.is_empty())
        .unwrap_or(trimmed)
        .to_string()
}

/// Decode a Claude projects-dir slug back to a path. Slugs encode `/` as `-`
/// with a leading `-` for the root (`-Users-halloweed-proj` → `/Users/halloweed/proj`).
/// Best-effort: project dirs containing `-` decode ambiguously.
fn decode_claude_project_dir(slug: &str) -> String {
    if let Some(rest) = slug.strip_prefix('-') {
        format!("/{}", rest.replace('-', "/"))
    } else {
        slug.to_string()
    }
}

/// Session id from a Codex rollout filename
/// (`rollout-2026-03-19T15-38-57-<uuid>.jsonl` → `<uuid>`).
fn codex_session_id(file_stem: &str) -> Option<String> {
    let stem = file_stem.strip_suffix(".jsonl").unwrap_or(file_stem);
    let parts: Vec<&str> = stem.split('-').collect();
    if parts.len() < 6 {
        return None;
    }
    // UUID tail is always 5 dash-groups (8-4-4-4-12); the head holds the
    // `rollout-<timestamp>` prefix which itself contains dashes.
    let tail = &parts[parts.len() - 5..];
    let expected = [8, 4, 4, 4, 12];
    let valid = tail
        .iter()
        .zip(expected)
        .all(|(group, len)| group.len() == len && group.bytes().all(|b| b.is_ascii_hexdigit()));
    if !valid {
        return None;
    }
    Some(tail.join("-"))
}

/// Working directory from the first line of a Codex rollout, whose
/// `session_meta` record carries it. Anything unparseable yields `None`.
fn codex_cwd(first_line: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(first_line).ok()?;
    value
        .get("payload")?
        .get("cwd")?
        .as_str()
        .map(str::to_string)
}

fn read_first_line(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    BufReader::new(file).lines().next()?.ok()
}

/// Minimal percent-decoder for `file://` folder URIs (handles `%20` etc.).
fn percent_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (
                (bytes[i + 1] as char).to_digit(16),
                (bytes[i + 2] as char).to_digit(16),
            ) {
                out.push((hi * 16 + lo) as u8);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Working directory from a Cursor workspace's `workspace.json`
/// (`{ "folder": "file:///Users/me/proj" }`).
fn cursor_cwd(workspace_json: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(workspace_json).ok()?;
    let folder = value.get("folder")?.as_str()?;
    let path = folder.strip_prefix("file://")?;
    if path.trim().is_empty() {
        return None;
    }
    Some(percent_decode(path))
}

fn push_session(
    out: &mut Vec<AgentSession>,
    raw: RawSession,
    now_ms: u128,
    status: &str,
    parent_live: bool,
) {
    if now_ms.saturating_sub(raw.last_active_ms) > MAX_IDLE_SECS as u128 * 1000 {
        return;
    }
    // Subagent sidecars are only worth reading while something might be
    // running: a live parent or a just-written transcript.
    let fresh = status_fresh(raw.last_active_ms, now_ms);
    let subagents = match (&raw.source_dir, raw.provider_id) {
        (Some(dir), "claude") if parent_live || fresh => {
            subagents::scan_subagents(dir, parent_live, now_ms, status_fresh)
        }
        _ => Vec::new(),
    };
    out.push(AgentSession {
        provider_id: raw.provider_id.to_string(),
        provider_name: raw.provider_name.to_string(),
        project_name: raw.project_name,
        session_id: raw.session_id,
        cwd: raw.cwd,
        title: raw.title,
        subagents,
        last_active_ms: raw.last_active_ms as f64,
        status: status.to_string(),
    });
}

fn scan_claude(projects_dir: &Path, out: &mut Vec<RawSession>) {
    let entries = match std::fs::read_dir(projects_dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for project_dir in entries.flatten() {
        let slug = project_dir.file_name().to_string_lossy().into_owned();
        let files = match std::fs::read_dir(project_dir.path()) {
            Ok(files) => files,
            Err(_) => continue,
        };
        let cwd = decode_claude_project_dir(&slug);
        let project_name = project_name_from_cwd(&cwd);
        for file in files.flatten() {
            let path = file.path();
            if !path.is_file() || path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
            let Some(last_active_ms) = file_mtime_ms(&path) else {
                continue;
            };
            let session_id = path
                .file_stem()
                .map(|stem| stem.to_string_lossy().into_owned())
                .unwrap_or_default();
            if session_id.is_empty() {
                continue;
            }
            out.push(RawSession {
                provider_id: "claude",
                provider_name: "Claude Code",
                project_name: project_name.clone(),
                session_id: session_id.clone(),
                cwd: Some(cwd.clone()),
                title: None,
                last_active_ms,
                source_dir: Some(project_dir.path().join(&session_id)),
            });
        }
    }
}

fn scan_codex_dir(dir: &Path, out: &mut Vec<RawSession>, depth: usize) {
    if depth > 6 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            scan_codex_dir(&path, out, depth + 1);
            continue;
        }
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        let file_name = entry.file_name().to_string_lossy().into_owned();
        let Some(session_id) = codex_session_id(&file_name) else {
            continue;
        };
        let Some(last_active_ms) = file_mtime_ms(&path) else {
            continue;
        };
        let cwd = read_first_line(&path).and_then(|line| codex_cwd(&line));
        let project_name = cwd
            .as_deref()
            .map(project_name_from_cwd)
            .unwrap_or_else(|| "Codex session".to_string());
            out.push(RawSession {
                provider_id: "codex",
                provider_name: "Codex",
                project_name,
                session_id,
                cwd,
                title: None,
                last_active_ms,
                source_dir: None,
            });
    }
}

fn scan_cursor(storage_dirs: &[PathBuf], out: &mut Vec<RawSession>) {
    let mut seen = HashSet::new();
    for storage_dir in storage_dirs {
        // Different candidates can resolve to the same dir; scan once.
        let canonical = storage_dir.canonicalize().unwrap_or_else(|_| storage_dir.clone());
        if !seen.insert(canonical) {
            continue;
        }
        let entries = match std::fs::read_dir(storage_dir) {
            Ok(entries) => entries,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let dir = entry.path();
            if !dir.is_dir() {
                continue;
            }
            let session_id = entry.file_name().to_string_lossy().into_owned();
            let state_db = dir.join("state.vscdb");
            let anchor = if state_db.is_file() { &state_db } else { &dir };
            let Some(last_active_ms) = file_mtime_ms(anchor) else {
                continue;
            };
            let cwd = std::fs::read_to_string(dir.join("workspace.json"))
                .ok()
                .and_then(|text| cursor_cwd(&text));
            let project_name = cwd
                .as_deref()
                .map(project_name_from_cwd)
                .unwrap_or_else(|| "Cursor workspace".to_string());
            out.push(RawSession {
                provider_id: "cursor",
                provider_name: "Cursor",
                project_name,
                session_id,
                cwd,
                title: None,
                last_active_ms,
                source_dir: None,
            });
        }
    }
}

fn claude_projects_dir(home: &Path) -> PathBuf {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("projects");
        }
    }
    home.join(".claude/projects")
}

fn codex_sessions_dir(home: &Path) -> PathBuf {
    if let Ok(dir) = std::env::var("CODEX_HOME") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("sessions");
        }
    }
    home.join(".codex/sessions")
}

fn cursor_storage_dirs(home: &Path) -> Vec<PathBuf> {
    let mut dirs = vec![
        home.join("Library/Application Support/Cursor/User/workspaceStorage"),
        home.join(".config/Cursor/User/workspaceStorage"),
    ];
    if let Some(config) = dirs::config_dir() {
        dirs.push(config.join("Cursor/User/workspaceStorage"));
    }
    dirs
}

fn collect_agent_sessions(
    home: &Path,
    claude_dir: &Path,
    codex_dir: &Path,
    cursor_dirs: &[PathBuf],
    now_ms: u128,
) -> Vec<AgentSession> {
    // The process sample sleeps 500ms between snapshots; run it alongside the
    // file/database scans instead of after them.
    let (pool, raw) = std::thread::scope(|scope| {
        let sample = scope.spawn(liveness::sample);
        let mut raw = Vec::new();
        let claude_raw = scope.spawn(|| {
            let mut out = Vec::new();
            scan_claude(claude_dir, &mut out);
            out
        });
        let codex_raw = scope.spawn(|| {
            let mut out = Vec::new();
            scan_codex_dir(codex_dir, &mut out, 0);
            out
        });
        let cursor_raw = scope.spawn(|| {
            let mut out = Vec::new();
            scan_cursor(cursor_dirs, &mut out);
            out
        });
        let opencode_raw = scope.spawn(|| {
            let mut out = Vec::new();
            opencode::scan_opencode(home, &mut out);
            out
        });
        raw.extend(claude_raw.join().unwrap_or_default());
        raw.extend(codex_raw.join().unwrap_or_default());
        raw.extend(cursor_raw.join().unwrap_or_default());
        raw.extend(opencode_raw.join().unwrap_or_default());
        (sample.join().unwrap_or_default(), raw)
    });
    resolve_all(raw, pool, now_ms)
}

#[cfg(test)]
fn collect_with_procs(
    home: &Path,
    claude_dir: &Path,
    codex_dir: &Path,
    cursor_dirs: &[PathBuf],
    pool: Vec<liveness::LiveProcess>,
    now_ms: u128,
) -> Vec<AgentSession> {
    let mut raw = Vec::new();
    scan_claude(claude_dir, &mut raw);
    scan_codex_dir(codex_dir, &mut raw, 0);
    scan_cursor(cursor_dirs, &mut raw);
    opencode::scan_opencode(home, &mut raw);
    resolve_all(raw, pool, now_ms)
}

fn resolve_all(
    mut raw: Vec<RawSession>,
    mut pool: Vec<liveness::LiveProcess>,
    now_ms: u128,
) -> Vec<AgentSession> {
    // Claim most-recent-first so a bare `claude --resume` (which continues the
    // newest session) lands on the right one.
    raw.sort_by(|a, b| b.last_active_ms.cmp(&a.last_active_ms));

    let snapshot = pool.clone();
    // Two passes: id matches first (order-independent), then the Claude
    // recency fallback most-recent-first, so a bare `claude --resume` lands on
    // the newest session and can never steal an id-bearing process.
    let mut id_matches: Vec<Option<bool>> = Vec::with_capacity(raw.len());
    for session in &raw {
        id_matches.push(
            liveness::provider_for_id(session.provider_id)
                .as_ref()
                .and_then(|provider| {
                    liveness::claim_by_id(&mut pool, provider, &session.session_id)
                }),
        );
    }
    let mut sessions = Vec::with_capacity(raw.len());
    for (session, id_match) in raw.into_iter().zip(id_matches) {
        let provider = liveness::provider_for_id(session.provider_id);
        let matched = match (id_match, &provider) {
            (Some(working), _) => Some(working),
            (None, Some(provider)) => {
                liveness::claim_fallback(&mut pool, provider, session.cwd.as_deref())
            }
            (None, None) => None,
        };
        let host_alive = provider
            .as_ref()
            // Unknown provider: never gate on a host process.
            .map(|provider| liveness::host_alive(&snapshot, provider))
            .unwrap_or(true);
        let parent_live = matched.is_some();
        let status = liveness::resolve_status(
            matched,
            status_fresh(session.last_active_ms, now_ms),
            host_alive,
            liveness::is_strict(session.provider_id),
        );
        push_session(&mut sessions, session, now_ms, status, parent_live);
    }
    sessions.sort_by(|a, b| {
        b.last_active_ms
            .partial_cmp(&a.last_active_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    sessions.truncate(MAX_SESSIONS);
    sessions
}

/// Served-first cache so opening the Agents tab (and its minute poll) rarely
/// pays for a full rescan. Statuses go slightly stale within the window —
/// acceptable for a 60s-polling page, and a manual refresh always recomputes.
const CACHE_TTL_MS: u128 = 15_000;

static SESSION_CACHE: std::sync::Mutex<Option<(u128, Vec<AgentSession>)>> =
    std::sync::Mutex::new(None);

/// List recent local agent sessions across Claude Code, Codex, Cursor,
/// OpenCode, and OpenCode2, most recently active first. 100% local: transcript
/// metadata only, never message content, nothing leaves the machine.
#[tauri::command]
#[specta::specta]
pub fn list_agent_sessions(refresh: Option<bool>) -> Vec<AgentSession> {
    let now_ms = unix_now_ms();
    if !refresh.unwrap_or(false) {
        if let Ok(cache) = SESSION_CACHE.lock() {
            if let Some((cached_at, sessions)) = cache.as_ref() {
                if now_ms.saturating_sub(*cached_at) <= CACHE_TTL_MS {
                    return sessions.clone();
                }
            }
        }
    }
    let Some(home) = dirs::home_dir() else {
        return Vec::new();
    };
    let sessions = collect_agent_sessions(
        &home,
        &claude_projects_dir(&home),
        &codex_sessions_dir(&home),
        &cursor_storage_dirs(&home),
        now_ms,
    );
    if let Ok(mut cache) = SESSION_CACHE.lock() {
        *cache = Some((now_ms, sessions.clone()));
    }
    sessions
}

#[cfg(test)]
mod tests;
