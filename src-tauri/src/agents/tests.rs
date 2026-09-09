    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(tag: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock before epoch")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "usagepal-agents-{}-{}-{}",
            tag,
            std::process::id(),
            nanos
        ))
    }

    fn write_file(path: &Path, content: &str) {
        std::fs::create_dir_all(path.parent().expect("file has parent"))
            .expect("create fixture dirs");
        std::fs::write(path, content).expect("write fixture file");
    }

    #[test]
    fn project_name_uses_last_component() {
        assert_eq!(
            project_name_from_cwd("/Users/halloweed/Coding/Projects/usagepal"),
            "usagepal"
        );
        assert_eq!(project_name_from_cwd("/Users/halloweed/"), "halloweed");
        assert_eq!(project_name_from_cwd("/"), "/");
    }

    #[test]
    fn fresh_window_flags_recent_writes() {
        let now = 1_000_000_000_000u128;
        assert!(status_fresh(now, now));
        assert!(status_fresh(now - FRESH_WINDOW_SECS as u128 * 1000, now));
        assert!(!status_fresh(
            now - FRESH_WINDOW_SECS as u128 * 1000 - 1,
            now
        ));
    }

    #[test]
    fn parses_codex_session_id_from_rollout_filename() {
        assert_eq!(
            codex_session_id(
                "rollout-2026-03-19T15-38-57-019d0508-8391-7881-8858-a2fdabe99967.jsonl"
            ),
            Some("019d0508-8391-7881-8858-a2fdabe99967".to_string())
        );
        assert_eq!(codex_session_id("rollout-foo.jsonl"), None);
        assert_eq!(codex_session_id("notes.jsonl"), None);
    }

    #[test]
    fn parses_codex_cwd_from_session_meta_line() {
        let line = r#"{"type":"session_meta","payload":{"id":"abc","cwd":"/Users/me/proj"}}"#;
        assert_eq!(codex_cwd(line), Some("/Users/me/proj".to_string()));
        assert_eq!(codex_cwd("not json"), None);
        assert_eq!(codex_cwd(r#"{"type":"other","payload":{}}"#), None);
    }

    #[test]
    fn parses_cursor_folder_uri() {
        let json = r#"{"folder": "file:///Users/me/my%20proj"}"#;
        assert_eq!(cursor_cwd(json), Some("/Users/me/my proj".to_string()));
        assert_eq!(cursor_cwd(r#"{}"#), None);
        assert_eq!(cursor_cwd(r#"{"folder": ""}"#), None);
    }

    #[test]
    fn scans_claude_projects_dir() {
        let root = unique_temp_dir("claude");
        let slug = "-Users-me-usagepal";
        write_file(&root.join(slug).join("abc123.jsonl"), "{}\n");
        write_file(&root.join(slug).join("notes.txt"), "skip me");

        let mut out = Vec::new();
        claude::scan_claude(&root, &mut out);

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].provider_id, "claude");
        assert_eq!(out[0].session_id, "abc123");
        assert_eq!(out[0].project_name, "usagepal");
        assert_eq!(out[0].cwd.as_deref(), Some("/Users/me/usagepal"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scans_codex_sessions_recursively() {
        let root = unique_temp_dir("codex");
        let rollout =
            "rollout-2026-03-19T15-38-57-019d0508-8391-7881-8858-a2fdabe99967.jsonl";
        write_file(
            &root.join("2026/09/08").join(rollout),
            "{\"type\":\"session_meta\",\"payload\":{\"id\":\"x\",\"cwd\":\"/Users/me/kota\"}}\n",
        );
        write_file(&root.join("2026/09/08").join("junk.txt"), "skip");

        let mut out = Vec::new();
        scan_codex_dir(&root, &mut out, 0);

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].provider_id, "codex");
        assert_eq!(
            out[0].session_id,
            "019d0508-8391-7881-8858-a2fdabe99967"
        );
        assert_eq!(out[0].project_name, "kota");
        assert_eq!(out[0].cwd.as_deref(), Some("/Users/me/kota"));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn scans_cursor_workspaces() {
        let root = unique_temp_dir("cursor");
        write_file(
            &root.join("abc123/workspace.json"),
            "{\"folder\": \"file:///Users/me/keylight\"}",
        );
        write_file(&root.join("abc123/state.vscdb"), "db");

        let mut out = Vec::new();
        scan_cursor(&[root.clone()], &mut out);

        assert_eq!(out.len(), 1);
        assert_eq!(out[0].provider_id, "cursor");
        assert_eq!(out[0].session_id, "abc123");
        assert_eq!(out[0].project_name, "keylight");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn omits_sessions_idle_beyond_retention() {
        let mut out = Vec::new();
        let now = 1_000_000_000_000u128;
        let ancient = now - MAX_IDLE_SECS as u128 * 1000 - 1;
        push_session(
            &mut out,
            RawSession {
                provider_id: "claude",
                provider_name: "Claude Code",
                project_name: "old".to_string(),
                session_id: "s1".to_string(),
                cwd: None,
                title: None,
                last_active_ms: ancient,
                source_dir: None,
            },
            now,
            "closed",
            false,
        );
        assert!(out.is_empty());
    }

    #[test]
    fn collects_and_sorts_most_recent_first() {
        let root = unique_temp_dir("collect");
        write_file(&root.join("claude").join("-Users-me-bbb/old.jsonl"), "{}\n");
        write_file(&root.join("codex").join("skip.txt"), "x");
        let now = unix_now_ms();

        let sessions = collect_with_procs(
            &root,
            &root.join("claude"),
            &root.join("codex"),
            &[root.join("cursor-missing")],
            Vec::new(),
            now,
        );

        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].project_name, "bbb");
        // Empty process pool: strict Claude → closed.
        assert_eq!(sessions[0].status, "closed");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn live_process_decides_active_and_closed() {
        use crate::agents::liveness::{LiveProcess, Provider};

        let root = unique_temp_dir("live");
        let busy_id = "11111111-2222-3333-4444-555555555555";
        let idle_id = "66666666-7777-8888-9999-000000000000";
        let gone_id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        let slug = "-Users-me-live";
        write_file(&root.join(slug).join(format!("{busy_id}.jsonl")), "{}\n");
        write_file(&root.join(slug).join(format!("{idle_id}.jsonl")), "{}\n");
        write_file(&root.join(slug).join(format!("{gone_id}.jsonl")), "{}\n");
        write_file(
            &root.join(format!("{slug}/{busy_id}/subagents/agent-a1.jsonl")),
            "{}\n",
        );
        write_file(
            &root.join(format!("{slug}/{busy_id}/subagents/agent-a1.meta.json")),
            r#"{"agentType":"Explore","description":"Map the auth flow","model":"sonnet"}"#,
        );
        let now = unix_now_ms();
        let pool = vec![
            LiveProcess {
                provider: Provider::Claude,
                cmd: format!("claude --resume {busy_id}"),
                cwd: None,
                working: true,
            },
            LiveProcess {
                provider: Provider::Claude,
                cmd: format!("claude --resume {idle_id}"),
                cwd: None,
                working: false,
            },
        ];

        let sessions = collect_with_procs(
            &root,
            &root,
            &root.join("codex-missing"),
            &[root.join("cursor-missing")],
            pool,
            now,
        );

        let status_of = |id: &str| {
            sessions
                .iter()
                .find(|s| s.session_id == id)
                .map(|s| s.status.as_str())
        };
        assert_eq!(status_of(busy_id), Some("active"));
        // Quiet tree but the file was just written (streaming) → active.
        assert_eq!(status_of(idle_id), Some("active"));
        // Recent file but no process: the /new case → closed, not active.
        assert_eq!(status_of(gone_id), Some("closed"));

        // Subagents attach to the live session with meta fields intact.
        let busy = sessions
            .iter()
            .find(|s| s.session_id == busy_id)
            .expect("busy session");
        assert_eq!(busy.subagents.len(), 1);
        assert_eq!(busy.subagents[0].id, "a1");
        assert_eq!(busy.subagents[0].agent_type.as_deref(), Some("Explore"));
        assert_eq!(busy.subagents[0].status, "active");
        let gone = sessions
            .iter()
            .find(|s| s.session_id == gone_id)
            .expect("gone session");
        assert!(gone.subagents.is_empty());

        let _ = std::fs::remove_dir_all(&root);
    }
