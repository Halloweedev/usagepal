//! OpenCode + OpenCode2 session discovery.
//!
//! Both tools share `~/.local/share/opencode/opencode.db`: v1 writes the
//! `session` table, OpenCode2 writes `session_v2`. Both tables carry the
//! working directory, title, and update timestamps, so no message or part
//! content is ever read. Queries go through the `sqlite3` CLI in read-only
//! mode, mirroring `plugin_engine::host_api` — a missing binary or locked DB
//! yields no sessions, never an error.

use std::path::{Path, PathBuf};
use std::time::Duration;

use super::RawSession;

/// Cap per table; the global list truncates again after merging providers.
const TABLE_LIMIT: u32 = 50;
const SQLITE_TIMEOUT: Duration = Duration::from_secs(10);

pub struct OpenCodeRow {
    pub id: String,
    pub directory: String,
    pub title: Option<String>,
    pub time_updated: i64,
}

fn query_for(table: &str) -> Option<String> {
    if table != "session" && table != "session_v2" {
        return None;
    }
    Some(format!(
        "SELECT id, directory, title, time_updated FROM {} ORDER BY time_updated DESC LIMIT {};",
        table, TABLE_LIMIT
    ))
}

/// Runs `sqlite3 -readonly -json`, falling back to `immutable=1` to bypass
/// WAL/SHM lock issues after macOS sleep. Same shape as the plugin host's
/// sqlite helper.
fn run_sqlite_json(db: &Path, sql: &str) -> Result<String, String> {
    let db_str = db.to_string_lossy();
    let primary = std::process::Command::new("sqlite3")
        .args(["-readonly", "-json", db_str.as_ref(), sql])
        .output()
        .map_err(|e| format!("sqlite3 exec failed: {}", e))?;

    if primary.status.success() {
        return Ok(String::from_utf8_lossy(&primary.stdout).to_string());
    }

    let encoded = db_str
        .replace('%', "%25")
        .replace(' ', "%20")
        .replace('#', "%23")
        .replace('?', "%3F");
    let uri_path = format!("file:{}?immutable=1", encoded);
    let fallback = std::process::Command::new("sqlite3")
        .args(["-json", &uri_path, sql])
        .output()
        .map_err(|e| format!("sqlite3 exec failed: {}", e))?;
    if fallback.status.success() {
        return Ok(String::from_utf8_lossy(&fallback.stdout).to_string());
    }
    Err(format!(
        "sqlite3 error: {}",
        String::from_utf8_lossy(&fallback.stderr).trim()
    ))
}

fn parse_rows(stdout: &str) -> Vec<OpenCodeRow> {
    let values: Vec<serde_json::Value> = serde_json::from_str(stdout).unwrap_or_default();
    let mut rows = Vec::with_capacity(values.len());
    for value in values {
        let Some(id) = value.get("id").and_then(|id| id.as_str()) else {
            continue;
        };
        let Some(directory) = value.get("directory").and_then(|dir| dir.as_str()) else {
            continue;
        };
        if id.is_empty() || directory.is_empty() {
            continue;
        }
        let time_updated = value
            .get("time_updated")
            .and_then(|ts| ts.as_i64())
            .unwrap_or(0);
        rows.push(OpenCodeRow {
            id: id.to_string(),
            directory: directory.to_string(),
            title: value
                .get("title")
                .and_then(|title| title.as_str())
                .filter(|title| !title.trim().is_empty())
                .map(str::to_string),
            time_updated,
        });
    }
    rows
}

fn query_table(db: &Path, table: &str) -> Vec<OpenCodeRow> {
    let Some(sql) = query_for(table) else {
        return Vec::new();
    };
    let db_owned = db.to_path_buf();
    let sql_owned = sql.clone();
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let result = run_sqlite_json(&db_owned, &sql_owned);
        let _ = tx.send(result);
    });
    match rx.recv_timeout(SQLITE_TIMEOUT) {
        Ok(Ok(stdout)) => parse_rows(&stdout),
        Ok(Err(message)) => {
            log::warn!("opencode {} query failed: {}", table, message);
            Vec::new()
        }
        Err(_) => {
            log::warn!("opencode {} query timed out; skipping", table);
            Vec::new()
        }
    }
}

/// Candidate locations for the shared OpenCode database.
fn db_candidates(home: &Path) -> Vec<PathBuf> {
    let mut candidates = vec![home.join(".local/share/opencode/opencode.db")];
    if let Some(data_dir) = dirs::data_dir() {
        candidates.push(data_dir.join("opencode/opencode.db"));
    }
    candidates
}

fn find_db(home: &Path) -> Option<PathBuf> {
    db_candidates(home).into_iter().find(|path| path.is_file())
}

pub fn scan_opencode(home: &Path, out: &mut Vec<RawSession>) {
    let Some(db) = find_db(home) else {
        return;
    };
    for (table, provider_id, provider_name) in [
        ("session", "opencode", "OpenCode"),
        ("session_v2", "opencode2", "OpenCode2"),
    ] {
        for row in query_table(&db, table) {
            let project_name = super::project_name_from_cwd(&row.directory);
            out.push(RawSession {
                provider_id,
                provider_name,
                project_name,
                session_id: row.id,
                cwd: Some(row.directory),
                title: row.title,
                last_active_ms: row.time_updated.max(0) as u128,
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_tables() {
        assert!(query_for("session").is_some());
        assert!(query_for("session_v2").is_some());
        assert!(query_for("session; DROP TABLE session;").is_none());
        assert!(query_for("credential").is_none());
    }

    #[test]
    fn parses_session_rows() {
        let stdout = r#"[
            {"id":"ses_abc","directory":"/Users/me/proj","title":"Fix bug","time_updated":1788869785523},
            {"id":"ses_def","directory":"/Users/me/other","title":null,"time_updated":1788869780000},
            {"id":"ses_ghi","directory":"/Users/me/blank","title":"   ","time_updated":1788869700000},
            {"id":"","directory":"/Users/me/empty","title":"x","time_updated":1},
            {"nope":true}
        ]"#;
        let rows = parse_rows(stdout);
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].id, "ses_abc");
        assert_eq!(rows[0].title.as_deref(), Some("Fix bug"));
        assert!(rows[1].title.is_none());
        assert!(rows[2].title.is_none());
    }

    #[test]
    fn parses_garbage_as_no_rows() {
        assert!(parse_rows("").is_empty());
        assert!(parse_rows("not json").is_empty());
    }

    fn sqlite3_available() -> bool {
        std::process::Command::new("sqlite3")
            .arg("--version")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }

    /// End-to-end through a real fixture database: both tables map to their
    /// provider with directory, title, and recency status intact.
    #[test]
    fn scans_fixture_database() {
        if !sqlite3_available() {
            eprintln!("skipping: sqlite3 CLI not available");
            return;
        }
        let home = std::env::temp_dir().join(format!(
            "usagepal-agents-opencode-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("clock before epoch")
                .as_nanos()
        ));
        let db = home.join(".local/share/opencode/opencode.db");
        std::fs::create_dir_all(db.parent().expect("db has parent")).expect("fixture dirs");
        let db_str = db.to_string_lossy().into_owned();
        let now_ms = super::super::unix_now_ms();
        let recent = now_ms - 60_000;
        let setup = format!(
            "CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT NOT NULL, time_updated INTEGER NOT NULL); \
             CREATE TABLE session_v2 (id TEXT PRIMARY KEY, directory TEXT NOT NULL, title TEXT, time_updated INTEGER NOT NULL); \
             INSERT INTO session VALUES ('ses_v1', '/Users/me/alpha', 'Old title', {recent}); \
             INSERT INTO session_v2 VALUES ('ses_v2', '/Users/me/beta', 'New title', {recent});"
        );
        let status = std::process::Command::new("sqlite3")
            .args([db_str.as_str(), setup.as_str()])
            .status()
            .expect("create fixture db");
        assert!(status.success());

        let mut out = Vec::new();
        scan_opencode(&home, &mut out);

        assert_eq!(out.len(), 2);
        let v1 = out.iter().find(|s| s.provider_id == "opencode").expect("v1 row");
        assert_eq!(v1.provider_name, "OpenCode");
        assert_eq!(v1.project_name, "alpha");
        assert_eq!(v1.title.as_deref(), Some("Old title"));
        let v2 = out.iter().find(|s| s.provider_id == "opencode2").expect("v2 row");
        assert_eq!(v2.provider_name, "OpenCode2");
        assert_eq!(v2.project_name, "beta");
        assert_eq!(v2.cwd.as_deref(), Some("/Users/me/beta"));

        let _ = std::fs::remove_dir_all(&home);
    }

    #[test]
    fn missing_database_yields_no_sessions() {
        let mut out = Vec::new();
        scan_opencode(Path::new("/definitely/not/here"), &mut out);
        assert!(out.is_empty());
    }
}
