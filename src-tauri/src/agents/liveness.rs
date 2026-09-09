//! Process-aware liveness for agent sessions.
//!
//! Transcript mtimes alone can't tell a finished session from a working one —
//! a session that just ended still looks "recent". Running tools advertise
//! themselves in the process list (e.g. `claude --resume <session-id>`), so we
//! match sessions to live processes:
//!
//! - Own process tree doing work → `active`
//! - Own process tree quiet and nothing written → `idle` (alive but waiting,
//!   e.g. on approval)
//! - No process → `closed` for Claude (foreground CLI: no process means exited)
//! - Other providers may share one host process across sessions (OpenCode
//!   server, Cursor app), so without an attributable process they fall back to
//!   recency gated on a live host process.

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

/// Gap between the two process samples. 500ms clears macOS's 200ms minimum
/// CPU interval with margin while keeping the command snappy.
const SAMPLE_GAP: Duration = Duration::from_millis(500);
/// Subtree CPU burn (milliseconds) inside the sample gap that counts as work.
/// Calibrated 2026-09-09: long-idle Claude harnesses burn ~10ms per 500ms
/// window; a 0.2s tool call burns ~200ms. 50ms (10% of one core) sits well
/// above idle noise and far below real tool use.
const WORK_CPU_MS: u64 = 50;

/// Executable names whose CPU counts toward a session. Agent work flows
/// through shells, language runtimes, toolchains, and CLIs; everything else
/// in the tree (language servers, `caffeinate`, desktop helpers adopted from
/// the launch environment) is noise. The session root itself always counts.
fn is_worker(token: &str) -> bool {
    const EXACT: &[&str] = &[
        "sh", "bash", "zsh", "fish", "dash", "node", "bun", "deno", "npm", "yarn", "pnpm",
        "npx", "python", "pip", "uv", "uvx", "ruby", "perl", "php", "lua", "java",
        "cargo", "rustc", "go", "make", "cmake", "ninja", "tsc", "esbuild", "vite",
        "webpack", "xcodebuild", "swiftc", "clang", "gcc", "git", "hg", "svn", "gh",
        "docker", "ssh", "kubectl", "rg", "grep", "find", "fd", "jq", "curl", "wget",
        "ffmpeg", "sqlite3", "psql", "mysql", "codex", "claude", "gemini", "ollama",
    ];
    const PREFIX: &[&str] = &["python3", "python2", "node"];
    EXACT.contains(&token) || PREFIX.iter().any(|prefix| token.starts_with(prefix))
}

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
    /// True when the session's process tree burned CPU or was observed running
    /// inside the sample window — i.e. actually doing work, not just alive.
    pub working: bool,
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

#[derive(Debug, Clone)]
struct RawProc {
    pid: u32,
    ppid: Option<u32>,
    token: String,
    cmd: String,
    cwd: Option<PathBuf>,
    cpu_ms: u64,
}

fn snapshot(system: &mut System) -> Vec<RawProc> {
    // Only what session matching needs: identity (exe/cmd/cwd), parent links,
    // and CPU times. Skipping memory/user/environ/disk keeps this fast —
    // environ reads in particular are brutal per-process on macOS.
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cpu()
            .with_exe(sysinfo::UpdateKind::Always)
            .with_cmd(sysinfo::UpdateKind::Always)
            .with_cwd(sysinfo::UpdateKind::Always),
    );
    system
        .processes()
        .iter()
        .map(|(pid, process)| RawProc {
            pid: pid.as_u32(),
            ppid: process.parent().map(|parent| parent.as_u32()),
            token: token_for(process),
            cmd: process
                .cmd()
                .iter()
                .map(|arg| arg.to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(" "),
            cwd: process.cwd().map(|cwd| cwd.to_path_buf()),
            cpu_ms: process.accumulated_cpu_time(),
        })
        .collect()
}

/// All pids in the subtree rooted at `root` (root included), following
/// parent links. Children doing the work (shell tools, compilers, scripts)
/// count toward their session even while the parent sleeps on I/O.
fn subtree_pids(children: &HashMap<u32, Vec<u32>>, root: u32) -> Vec<u32> {
    let mut pids = vec![root];
    let mut index = 0;
    while index < pids.len() {
        if let Some(kids) = children.get(&pids[index]) {
            pids.extend(kids.iter().copied());
        }
        index += 1;
    }
    pids
}

/// Sample the process list twice; a session counts as working when its root
/// process plus allowlisted worker children burned CPU past the work
/// threshold inside the gap. Deliberately not "observed running": a mostly
/// idle interactive process is caught in Run state by random sampling.
/// The tree matters because agents sleep on tool I/O while children work.
pub fn sample() -> Vec<LiveProcess> {
    let mut system = System::new();
    let first = snapshot(&mut system);
    std::thread::sleep(SAMPLE_GAP);
    let second = snapshot(&mut system);

    let baseline: HashMap<u32, u64> = first
        .iter()
        .map(|proc| (proc.pid, proc.cpu_ms))
        .collect();
    let current: HashMap<u32, u64> = second
        .iter()
        .map(|proc| (proc.pid, proc.cpu_ms))
        .collect();
    let mut children: HashMap<u32, Vec<u32>> = HashMap::new();
    let mut tokens: HashMap<u32, String> = HashMap::new();
    for proc in &second {
        tokens.insert(proc.pid, proc.token.clone());
        if let Some(ppid) = proc.ppid {
            children.entry(ppid).or_default().push(proc.pid);
        }
    }

    second
        .into_iter()
        .filter_map(|proc| {
            let provider = classify(&proc.token)?;
            let members = countable_members(&children, &tokens, proc.pid);
            let cpu_delta: u64 = members
                .iter()
                .filter_map(|pid| {
                    let now = current.get(pid).copied()?;
                    Some(now.saturating_sub(baseline.get(pid).copied().unwrap_or(0)))
                })
                .sum();
            Some(LiveProcess {
                provider,
                cmd: proc.cmd,
                cwd: proc.cwd,
                working: cpu_delta >= WORK_CPU_MS,
            })
        })
        .collect()
}

/// Root plus worker-kind descendants. The root always counts; children only
/// when they look like agent-spawned tools (see `is_worker`).
fn countable_members(
    children: &HashMap<u32, Vec<u32>>,
    tokens: &HashMap<u32, String>,
    root: u32,
) -> Vec<u32> {
    let mut members = vec![root];
    for pid in subtree_pids(children, root).into_iter().skip(1) {
        let is_tool = tokens
            .get(&pid)
            .map(|token| is_worker(&token.to_lowercase()))
            .unwrap_or(false);
        if is_tool {
            members.push(pid);
        }
    }
    members
}

pub fn host_alive(procs: &[LiveProcess], provider: &Provider) -> bool {
    procs.iter().any(|proc्| &proc्.provider == provider)
}

/// Claim the live process belonging to a session by its session id in the
/// command line, removing it from the pool so concurrent sessions can't share
/// one process. Returns `Some(working)` when claimed. Session ids are long unique
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
        .map(|index| pool.remove(index).working)
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
            return Some(pool.remove(index).working);
        }
    }
    pool.iter()
        .position(|proc| &proc.provider == provider)
        .map(|index| pool.remove(index).working)
}

/// Map signals to a status. `matched` is `Some(working)` when the session owns
/// a live process; `fresh` means the transcript was written inside the fresh
/// window (streaming output counts as work even when the tree is momentarily
/// quiet); `host_alive` means a provider process exists for shared-host
/// providers.
pub fn resolve_status(
    matched: Option<bool>,
    fresh: bool,
    host_alive: bool,
    strict: bool,
) -> &'static str {
    match matched {
        Some(working) if working || fresh => "active",
        Some(_) => "idle",
        None if strict => "closed",
        None if fresh && host_alive => "active",
        None if host_alive => "idle",
        None => "closed",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proc(provider: Provider, cmd: &str, cwd: Option<&str>, working: bool) -> LiveProcess {
        LiveProcess {
            provider,
            cmd: cmd.to_string(),
            cwd: cwd.map(PathBuf::from),
            working,
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
    fn working_process_is_active_quiet_process_is_idle() {
        assert_eq!(resolve_status(Some(true), false, true, true), "active");
        assert_eq!(resolve_status(Some(true), true, false, false), "active");
        assert_eq!(resolve_status(Some(false), false, true, true), "idle");
        assert_eq!(resolve_status(Some(false), false, false, false), "idle");
    }

    #[test]
    fn quiet_but_streaming_counts_as_work() {
        // Tree asleep but the transcript was just written: tokens streaming.
        assert_eq!(resolve_status(Some(false), true, true, true), "active");
    }

    #[test]
    fn strict_provider_is_closed_without_a_process() {
        assert_eq!(resolve_status(None, true, true, true), "closed");
        assert_eq!(resolve_status(None, false, false, true), "closed");
    }

    #[test]
    fn shared_host_uses_freshness_gated_on_host() {
        assert_eq!(resolve_status(None, true, true, false), "active");
        assert_eq!(resolve_status(None, true, false, false), "closed");
        assert_eq!(resolve_status(None, false, true, false), "idle");
        assert_eq!(resolve_status(None, false, false, false), "closed");
    }

    #[test]
    fn workers_cover_shells_runtimes_and_toolchains() {
        for tool in [
            "bash", "zsh", "node", "bun", "python3", "python3.13", "cargo", "git", "rg",
            "docker", "ssh", "codex", "sqlite3",
        ] {
            assert!(is_worker(tool), "{tool} should count as worker");
        }
    }

    #[test]
    fn adopted_helpers_do_not_count_as_workers() {
        for helper in ["sourcekit-lsp", "caffeinate", "safari", "launchd", "Code Helper"] {
            assert!(
                !is_worker(&helper.to_lowercase()),
                "{helper} should not count as worker"
            );
        }
    }

    #[test]
    fn countable_members_keep_root_and_drop_noise() {
        let children: HashMap<u32, Vec<u32>> = [(1, vec![2, 3])].into_iter().collect();
        let tokens: HashMap<u32, String> = [
            (1, "claude".to_string()),
            (2, "sourcekit-lsp".to_string()),
            (3, "bash".to_string()),
        ]
        .into_iter()
        .collect();
        assert_eq!(countable_members(&children, &tokens, 1), vec![1, 3]);
    }

    #[test]
    fn subtree_includes_all_descendants() {        let children: HashMap<u32, Vec<u32>> =
            [(1, vec![2, 3]), (2, vec![4])].into_iter().collect();
        let mut members = subtree_pids(&children, 1);
        members.sort_unstable();
        assert_eq!(members, vec![1, 2, 3, 4]);
        assert_eq!(subtree_pids(&children, 3), vec![3]);
        assert_eq!(subtree_pids(&HashMap::new(), 9), vec![9]);
    }

    #[test]
    fn host_alive_checks_provider() {
        let procs = vec![proc(Provider::OpenCode, "opencode serve", None, false)];
        assert!(host_alive(&procs, &Provider::OpenCode));
        assert!(!host_alive(&procs, &Provider::OpenCode2));
    }
}
