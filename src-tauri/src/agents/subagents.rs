//! Claude Code subagent discovery.
//!
//! Each Task-spawned subagent gets `<session-id>/subagents/agent-<id>.jsonl`
//! plus a tiny `agent-<id>.meta.json` sidecar carrying only metadata
//! (agent type, task description, model). Transcript message content is never
//! read — the description is a task label, covered by the same metadata-only
//! rule as everything else in this module.

use serde::Serialize;
use specta::Type;
use std::path::{Path, PathBuf};

/// Most subagents shown per session; the rest are still counted upstream.
const MAX_SUBAGENTS: usize = 10;
/// Cap task descriptions so one chatty label can't bloat IPC or the UI.
const MAX_DESCRIPTION_LEN: usize = 120;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SubagentInfo {
    pub id: String,
    pub agent_type: Option<String>,
    pub description: Option<String>,
    pub model: Option<String>,
    /// Unix-ms of the subagent transcript's last write. f64: specta forbids u64.
    pub last_active_ms: f64,
    /// `"active"` when freshly written under a live parent session, else `"done"`.
    pub status: String,
}

fn truncate(text: &str, max: usize) -> String {
    if text.len() <= max {
        return text.to_string();
    }
    let end = text
        .char_indices()
        .take_while(|(i, _)| *i < max)
        .map(|(_, ch)| ch.len_utf8())
        .sum::<usize>()
        .min(text.len());
    format!("{}…", text[..end].trim_end())
}

fn read_meta(meta_path: &Path) -> (Option<String>, Option<String>, Option<String>) {
    let text = match std::fs::read_to_string(meta_path) {
        Ok(text) => text,
        Err(_) => return (None, None, None),
    };
    let value: serde_json::Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(_) => return (None, None, None),
    };
    let field = |name: &str| {
        value
            .get(name)?
            .as_str()
            .map(str::trim)
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    let description = field("description").map(|text| truncate(&text, MAX_DESCRIPTION_LEN));
    (field("agentType"), description, field("model"))
}

/// List a session's subagents, most recently written first. `parent_live` is
/// whether the parent session owns a live process; only a fresh write under a
/// live parent counts as running.
pub fn scan_subagents(
    session_dir: &Path,
    parent_live: bool,
    now_ms: u128,
    is_fresh: impl Fn(u128, u128) -> bool,
) -> Vec<SubagentInfo> {
    let entries = match std::fs::read_dir(session_dir.join("subagents")) {
        Ok(entries) => entries,
        Err(_) => return Vec::new(),
    };
    let mut agents = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.starts_with("agent-") || !name.ends_with(".jsonl") || name.ends_with(".meta.json") {
            continue;
        }
        let path = entry.path();
        let last_active_ms = match path
            .metadata()
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|modified| {
                modified
                    .duration_since(std::time::UNIX_EPOCH)
                    .ok()
                    .map(|elapsed| elapsed.as_millis())
            }) {
            Some(ms) => ms,
            None => continue,
        };
        let id = name
            .strip_prefix("agent-")
            .and_then(|rest| rest.strip_suffix(".jsonl"))
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        let meta_path = path.with_extension("").with_extension("meta.json");
        let (agent_type, description, model) = read_meta(&meta_path);
        let status = if parent_live && is_fresh(last_active_ms, now_ms) {
            "active"
        } else {
            "done"
        };
        agents.push(SubagentInfo {
            id: id.to_string(),
            agent_type,
            description,
            model,
            last_active_ms: last_active_ms as f64,
            status: status.to_string(),
        });
    }
    agents.sort_by(|a, b| {
        b.last_active_ms
            .partial_cmp(&a.last_active_ms)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    agents.truncate(MAX_SUBAGENTS);
    agents
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture_dir(tag: &str) -> PathBuf {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "usagepal-agents-subagents-{}-{}-{}",
            tag,
            std::process::id(),
            nanos
        ))
    }

    fn write(path: &Path, content: &str) {
        std::fs::create_dir_all(path.parent().expect("file has parent"))
            .expect("fixture dirs");
        std::fs::write(path, content).expect("fixture file");
    }

    fn now_ms() -> u128 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|elapsed| elapsed.as_millis())
            .unwrap_or(0)
    }

    #[test]
    fn lists_subagents_with_meta() {
        let dir = fixture_dir("meta");
        write(
            &dir.join("subagents/agent-abc.jsonl"),
            "{}\n",
        );
        write(
            &dir.join("subagents/agent-abc.meta.json"),
            r#"{"agentType":"Explore","description":"Map the auth flow","model":"sonnet"}"#,
        );
        write(&dir.join("subagents/notes.txt"), "skip");

        let agents = scan_subagents(&dir, true, now_ms(), |_, _| true);

        assert_eq!(agents.len(), 1);
        assert_eq!(agents[0].id, "abc");
        assert_eq!(agents[0].agent_type.as_deref(), Some("Explore"));
        assert_eq!(
            agents[0].description.as_deref(),
            Some("Map the auth flow")
        );
        assert_eq!(agents[0].model.as_deref(), Some("sonnet"));
        assert_eq!(agents[0].status, "active");

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn marks_done_without_live_parent_or_freshness() {
        let dir = fixture_dir("done");
        write(&dir.join("subagents/agent-abc.jsonl"), "{}\n");

        let parent_dead = scan_subagents(&dir, false, now_ms(), |_, _| true);
        assert_eq!(parent_dead[0].status, "done");

        let stale = scan_subagents(&dir, true, now_ms(), |_, _| false);
        assert_eq!(stale[0].status, "done");
        assert!(stale[0].agent_type.is_none());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn truncates_long_descriptions() {
        assert_eq!(truncate("short", 120), "short");
        let long = "x".repeat(200);
        let cut = truncate(&long, 120);
        assert!(cut.len() <= 124);
        assert!(cut.ends_with('…'));
    }

    #[test]
    fn missing_dir_yields_no_subagents() {
        let agents = scan_subagents(
            Path::new("/definitely/not/here"),
            true,
            now_ms(),
            |_, _| true,
        );
        assert!(agents.is_empty());
    }
}
