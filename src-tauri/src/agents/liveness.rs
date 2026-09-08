//! Process-aware liveness for agent sessions.
//!
//! Transcript mtimes alone can't tell a finished session from a working one —
//! a session that just ended still looks "recent". Running tools advertise
//! themselves in the process list (e.g. `claude --resume <session-id>`), so we
//! match sessions to live processes:
//!
//! - Own process, looking busy → `active`
//! - Own process, not busy → `idle` (alive but waiting, e.g. on approval)
//! - No process → `closed` for Claude (foreground CLI: no process means exited)
//! - Other providers may share one host process across sessions (OpenCode
//!   server, Cursor app), so without an attributable process they fall back to
//!   recency gated on a live host process.

use std::path::PathBuf;
use std::time::Duration;
use sysinfo::{ProcessRefreshKind, ProcessStatus, ProcessesToUpdate, System};

/// Pause between the two process samples backing busy detection.
const SAMPLE_GAP: Duration = Duration::from_millis(120);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Provider {
    Claude,
    Codex,
    Cursor,
    OpenCode,
    OpenCode2,
}

pub fn provider_for_id(provider_id: &str) -> Option<Provider> {
    match provider_id {
        "claude" => Some(Provider::Claude),
        "codex" => Some(Provider::Codex),
        "cursor" => Some(Provider::Cursor),
        "opencode" => Some(Provider::OpenCode),
        "opencode2" => Some(Provider::OpenCode2),
        _ => None,
    }
}

/// Only Claude gets strict treatment: its sessions always run as their own
/// foreground process, so no process means exited — no recency grace.
pub fn is_strict(provider_id: &str) -> bool {
    provider_id == "claude"
}

#[derive(Debug, Clone)]
pub struct LiveProcess {
    pub provider: Provider,
    pub cmd: String,
    pub cwd: Option<PathBuf>,
    pub busy: bool,
}

/// Classify a process by its executable name, falling back to the display name.
/// `opencode2` is checked before `opencode` (substring).
fn classify(token: &str) -> Option<Provider> {
    let token = token.to_lowercase();
    if token.contains("opencode2") {
        Some(Provider::OpenCode2)
    } else if token.contains("opencode") {
        Some(Provider::OpenCode)
    } else if token.contains("claude") {
        Some(Provider::Claude)
    } else if token.contains("codex") {
        Some(Provider::Codex)
    } else if token.contains("cursor") {
        Some(Provider::Cursor)
    } else {
        None
    }
}

fn token_for(process: &sysinfo::Process) -> String {
    process
        .exe()
        .and_then(|exe| exe.file_name())
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| process.name().to_string_lossy().into_owned())
}

fn snapshot(system: &mut System) -> Vec<(u32, String, String, Option<PathBuf>, ProcessStatus)> {
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::everything(),
    );
    system
        .processes()
        .iter()
        .map(|(pid, process)| {
            (
                pid.as_u32(),
                token_for(process),
                process
                    .cmd()
                    .iter()
                    .map(|arg| arg.to_string_lossy().into_owned())
                    .collect::<Vec<_>>()
                    .join(" "),
                process.cwd().map(|cwd| cwd.to_path_buf()),
                process.status(),
            )
        })
        .collect()
}

/// Sample the process list twice; a process observed running in either sample
/// counts as busy. Single-sample status would misread a working agent paused
/// on tool I/O as idle.
pub fn sample() -> Vec<LiveProcess> {
    let mut system = System::new();
    let first = snapshot(&mut system);
    std::thread::sleep(SAMPLE_GAP);
    let second = snapshot(&mut system);

    let busy_pids: std::collections::HashSet<u32> = first
        .iter()
        .chain(second.iter())
        .filter(|(_, _, _, _, status)| *status == ProcessStatus::Run)
        .map(|(pid, _, _, _, _)| *pid)
        .collect();

    // Classify off the second sample; pids present in both agree on identity.
    second
        .into_iter()
        .filter_map(|(pid, token, cmd, cwd, _)| {
            classify(&token).map(|provider| LiveProcess {
                provider,
                cmd,
                cwd,
                busy: busy_pids.contains(&pid),
            })
        })
        .collect()
}

pub fn host_alive(procs: &[LiveProcess], provider: &Provider) -> bool {
    procs.iter().any(|proc्| &proc्.provider == provider)
}

/// Claim the live process belonging to a session by its session id in the
/// command line, removing it from the pool so concurrent sessions can't share
/// one process. Returns `Some(busy)` when claimed. Session ids are long unique
/// tokens (UUIDs, `ses_*`), so a substring match is safe. Run for every
/// session before `claim_fallback`, so an id-bearing process can never be
/// stolen by the recency fallback.
pub fn claim_by_id(
    pool: &mut Vec<LiveProcess>,
    provider: &Provider,
    session_id: &str,
) -> Option<bool> {
    pool.iter()
        .position(|proc| &proc.provider == provider && proc.cmd.contains(session_id))
        .map(|index| pool.remove(index).busy)
}

/// Claim an unattributed process for a session (Claude only): first by working
/// directory, then any remaining Claude process. A bare `claude --resume`
/// continues the most recent session, and callers iterate most-recent-first so
/// it lands on the right one.
pub fn claim_fallback(
    pool: &mut Vec<LiveProcess>,
    provider: &Provider,
    cwd: Option<&str>,
) -> Option<bool> {
    if *provider != Provider::Claude {
        return None;
    }
    if let Some(cwd) = cwd {
        if let Some(index) = pool.iter().position(|proc| {
            &proc.provider == provider
                && proc.cwd.as_deref().map(|dir| dir.as_os_str()) == Some(std::ffi::OsStr::new(cwd))
        }) {
            return Some(pool.remove(index).busy);
        }
    }
    pool.iter()
        .position(|proc| &proc.provider == provider)
        .map(|index| pool.remove(index).busy)
}

/// Map signals to a status. `matched` is `Some(busy)` when the session owns a
/// live process; `recent` means activity inside the active window.
pub fn resolve_status(
    matched: Option<bool>,
    recent: bool,
    host_alive: bool,
    strict: bool,
) -> &'static str {
    match matched {
        Some(true) => "active",
        Some(false) => "idle",
        None if strict => "closed",
        None if recent && host_alive => "active",
        None if host_alive => "idle",
        None => "closed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(provider: Provider, cmd: &str, cwd: Option<&str>, busy: bool) -> LiveProcess {
        LiveProcess {
            provider,
            cmd: cmd.to_string(),
            cwd: cwd.map(PathBuf::from),
            busy,
        }
    }

    #[test]
    fn classifies_opencode2_before_opencode() {
        assert_eq!(classify("opencode2"), Some(Provider::OpenCode2));
        assert_eq!(classify("opencode"), Some(Provider::OpenCode));
        assert_eq!(classify("/opt/homebrew/bin/opencode2"), Some(Provider::OpenCode2));
        assert_eq!(classify("Claude"), Some(Provider::Claude));
        assert_eq!(classify("Cursor Helper"), Some(Provider::Cursor));
        assert_eq!(classify("codex"), Some(Provider::Codex));
        assert_eq!(classify("safari"), None);
    }

    #[test]
    fn claims_by_session_id_first() {
        let mut pool = vec![
            proc(Provider::Claude, "claude --resume aaa", Some("/x"), false),
            proc(Provider::Claude, "claude --resume bbb", Some("/y"), true),
        ];
        assert_eq!(
            claim_by_id(&mut pool, &Provider::Claude, "bbb"),
            Some(true)
        );
        assert_eq!(pool.len(), 1);
    }

    #[test]
    fn claude_falls_back_to_cwd_then_recency() {
        let mut pool = vec![proc(Provider::Claude, "claude", Some("/proj"), false)];
        assert_eq!(
            claim_fallback(&mut pool, &Provider::Claude, Some("/proj")),
            Some(false)
        );
        assert!(pool.is_empty());
    }

    #[test]
    fn recency_fallback_ignores_cwd_mismatch() {
        let mut pool = vec![proc(Provider::Claude, "claude", Some("/proj"), false)];
        // Wrong cwd still claims the only Claude process (bare --resume
        // continues the most recent session; callers order most-recent-first).
        assert_eq!(
            claim_fallback(&mut pool, &Provider::Claude, Some("/other")),
            Some(false)
        );
        assert!(pool.is_empty());
    }

    #[test]
    fn non_claude_has_no_fallback() {
        let mut pool = vec![proc(Provider::OpenCode, "opencode serve", Some("/p"), false)];
        assert_eq!(claim_fallback(&mut pool, &Provider::OpenCode, Some("/p")), None);
        assert_eq!(pool.len(), 1);
    }

    #[test]
    fn busy_process_is_active_idle_process_is_idle() {
        assert_eq!(resolve_status(Some(true), true, true, true), "active");
        assert_eq!(resolve_status(Some(false), true, true, true), "idle");
        assert_eq!(resolve_status(Some(false), false, false, false), "idle");
    }

    #[test]
    fn strict_provider_is_closed_without_a_process() {
        assert_eq!(resolve_status(None, true, true, true), "closed");
        assert_eq!(resolve_status(None, false, false, true), "closed");
    }

    #[test]
    fn shared_host_uses_recency_gated_on_host() {
        assert_eq!(resolve_status(None, true, true, false), "active");
        assert_eq!(resolve_status(None, true, false, false), "closed");
        assert_eq!(resolve_status(None, false, true, false), "idle");
        assert_eq!(resolve_status(None, false, false, false), "closed");
    }

    #[test]
    fn host_alive_checks_provider() {
        let procs = vec![proc(Provider::OpenCode, "opencode serve", None, false)];
        assert!(host_alive(&procs, &Provider::OpenCode));
        assert!(!host_alive(&procs, &Provider::OpenCode2));
    }
}
