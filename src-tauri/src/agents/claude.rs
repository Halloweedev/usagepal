//! Claude Code session discovery.
//!
//! Sessions are `<slug>/<session-id>.jsonl` files; slugs decode back to
//! working directories. Subagent sidecars live beside them (see
//! `subagents.rs`). Only names and mtimes are read here.

use super::{file_mtime_ms, project_name_from_cwd, RawSession};
use std::path::{Path, PathBuf};

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

pub(crate) fn claude_projects_dir(home: &Path) -> PathBuf {
    if let Ok(dir) = std::env::var("CLAUDE_CONFIG_DIR") {
        let trimmed = dir.trim();
        if !trimmed.is_empty() {
            return PathBuf::from(trimmed).join("projects");
        }
    }
    home.join(".claude/projects")
}

pub(crate) fn scan_claude(projects_dir: &Path, out: &mut Vec<RawSession>) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_claude_project_slug() {
        assert_eq!(
            decode_claude_project_dir("-Users-halloweed-Coding-Projects-usagepal"),
            "/Users/halloweed/Coding/Projects/usagepal"
        );
    }

    #[test]
    fn passes_through_slug_without_leading_dash() {
        assert_eq!(decode_claude_project_dir("usagepal"), "usagepal");
    }
}
