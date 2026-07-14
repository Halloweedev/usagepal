#![allow(clippy::all, dead_code, unused)]
//! Vendored ccusage v20.0.2 Rust core (MIT). See `VENDORING.md` for the
//! provenance of every file in this crate, and for exactly what is and is
//! not byte-identical to upstream.
//!
//! This file is NOT vendored — upstream has no `lib.rs` (it is a `[[bin]]`
//! crate: `src/main.rs`). This is the crate root we own, standing in for
//! the handful of things `main.rs` used to provide to its sibling modules:
//! the `Result`/`CliError` type used pervasively for fallible loads, and the
//! crate-root re-exports that let `claude_loader.rs` etc. resolve their
//! (unedited) `use crate::{...}` paths. `cli.rs` is similarly not vendored;
//! see that file's own header comment.
//!
//! **Visibility, and what this does *not* solve:** every re-export below is
//! `pub(crate)`, exactly mirroring what upstream's `main.rs` did (mostly
//! plain/`pub(crate) use`) — i.e. visible within *this* crate only. Rust
//! rejects re-exporting a `pub(crate)` item as `pub` (E0364/E0365: you
//! cannot widen an item's effective visibility past what it was declared
//! with, only alias it at the same-or-narrower level), so a `pub use` here
//! cannot make e.g. `types::UsageSummary` or
//! `claude_loader::load_daily_summaries` callable from `usagepal` — doing
//! that requires changing those *vendored* files' own `pub(crate)` to
//! `pub`, which is explicitly out of scope for Task 2 (see VENDORING.md,
//! "Public API boundary for Task 3"). The one exception is `cli.rs`, which
//! is not vendored (it's a hand-extracted shim owned by this crate, see
//! that file's header) — its `SharedArgs`/`CostMode`/`SortOrder` are
//! declared genuinely `pub` here at no cost, so at least those are already
//! usable across the crate boundary.
//!
//! `adapter` (containing the vendored `adapter/codex.rs`) needs three
//! additional non-vendored modules to satisfy its unedited `use crate::{...}`
//! imports: `terminal_stub` and `output_stub` (inert, unreachable-from-the-
//! pure-data-path stand-ins for CLI/terminal rendering symbols) and
//! `report_support` (two small functions that ARE reachable from the
//! pure-data path and are ported verbatim, not stubbed). See each module's
//! header and `VENDORING.md` ("The cut line") for the full reasoning.

mod adapter;
mod claude_loader;
mod claude_report;
mod cli;
mod codex_loader;
mod cost;
mod date_utils;
mod fast;
mod home;
mod logger;
mod output_stub;
mod pricing;
mod progress;
mod report_support;
mod terminal_stub;
mod types;
mod utils;

use std::{
    ffi::OsString,
    fmt,
    path::Path,
    sync::{Mutex, MutexGuard},
};

use serde_json::json;

/// Mirrors upstream `main.rs`'s `Result<T>` / `CliError`, which the vendored
/// modules rely on via `use crate::{Result, ...}`.
pub(crate) type Result<T> = std::result::Result<T, CliError>;

#[derive(Debug)]
pub(crate) struct CliError(pub(crate) String);

impl fmt::Display for CliError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl std::error::Error for CliError {}

impl From<std::io::Error> for CliError {
    fn from(error: std::io::Error) -> Self {
        Self(error.to_string())
    }
}

impl From<serde_json::Error> for CliError {
    fn from(error: serde_json::Error) -> Self {
        Self(error.to_string())
    }
}

pub(crate) fn cli_error(message: impl Into<String>) -> CliError {
    CliError(message.into())
}

// Crate-root re-exports so the vendored modules' unedited `use crate::{...}`
// paths resolve, mirroring exactly what `main.rs` re-exported at the top of
// the upstream binary crate (same `pub(crate)` visibility upstream used).
pub(crate) use claude_loader::{
    chunk_file_indexes_by_size, collect_files_with_extension, collect_usage_files,
    filter_loaded_entries_by_date, load_daily_summaries, load_entries,
};
pub(crate) use codex_loader::{codex_usage_paths, load_codex_events, visit_codex_session_file};
pub(crate) use cost::{calculate_cost, calculate_cost_for_usage};
pub(crate) use date_utils::*;
pub(crate) use logger::{debug_log, log_level};
pub(crate) use output_stub::{
    format_currency, format_models_multiline, format_number, print_json_or_jq, wants_json,
};
pub(crate) use pricing::PricingMap;
pub(crate) use report_support::{json_float, week_start};
pub(crate) use terminal_stub::{color, print_box_title, Align, Color, SimpleTable};
pub(crate) use types::*;
pub(crate) use utils::{
    apply_total_token_fallback, json_value_u64, non_empty_json_string, total_usage_tokens,
};

// `cli.rs` is ours (not vendored), so its items are declared genuinely
// `pub` there — no widening-visibility problem, so a real `pub use` works.
pub use cli::{CostMode, SharedArgs, SortOrder};

// ---------------------------------------------------------------------------
// Public API (the only `pub fn`s this crate exposes; called by
// `usagepal`'s `plugin_engine::ccusage` adapter)
//
// These wrappers exist because everything the adapter needs is `pub(crate)`
// (that is how upstream declared it, and vendored files are not edited to
// widen it). A `pub fn` here CAN call a `pub(crate) fn`, and by returning
// `serde_json::Value` it never names a `pub(crate)` type in its signature —
// so `UsageSummary`, `PricingMap`, `CodexGroup` etc. stay exactly as
// upstream declared them.
//
// Each wrapper reproduces the body of the corresponding upstream CLI command,
// minus the printing. No aggregation, cost, dedup or formatting logic is
// written here — it is all called into.
// ---------------------------------------------------------------------------

/// Whether `PricingMap::load` may refresh pricing from LiteLLM over the
/// network on every query.
///
/// Upstream's `--offline` flag defaults to `false`, so the `bunx ccusage`
/// subprocess this crate replaces did a live LiteLLM fetch on *every* refresh.
/// In-process we pin it to `true` (embedded pricing only):
///
/// - It is **output-identical** on the differential corpus — the vendored
///   embedded pricing tables and live LiteLLM agree to the last float bit for
///   the fixture's models, so this is not a semantic change, it is the same
///   numbers without the network call.
/// - It makes every query deterministic and offline-safe. With `false`, a
///   LiteLLM outage, a captive portal, or an upstream pricing edit would move
///   users' spend figures (or hang a UI refresh) with no local change.
///
/// A cached/refreshable pricing source is Task 4's job, not a flag flip here.
const OFFLINE_PRICING: bool = true;

/// Serializes the wrappers below. They must mutate process-wide environment
/// variables (`CLAUDE_CONFIG_DIR` / `CODEX_HOME`) because that is the only
/// channel the vendored path resolvers accept a home override through
/// (`claude_loader::claude_paths`, `codex_loader::codex_home_paths`) — the
/// subprocess set the same two variables, just on the child. `setenv` races
/// concurrent `getenv` in the same process, so all env mutation and all
/// reads of it happen under this one lock.
static ENV_LOCK: Mutex<()> = Mutex::new(());

fn env_lock() -> MutexGuard<'static, ()> {
    ENV_LOCK.lock().unwrap_or_else(|err| err.into_inner())
}

/// Sets an environment variable for the lifetime of the guard, restoring the
/// previous value (or unsetting it) on drop. Only constructed while `ENV_LOCK`
/// is held.
struct EnvVarGuard {
    key: &'static str,
    previous: Option<OsString>,
}

impl EnvVarGuard {
    fn set(key: &'static str, value: Option<&Path>) -> Option<Self> {
        let value = value?;
        let previous = std::env::var_os(key);
        // Safe here (this crate is edition 2021) and race-free (ENV_LOCK held).
        std::env::set_var(key, value);
        Some(Self { key, previous })
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        match self.previous.take() {
            Some(previous) => std::env::set_var(self.key, previous),
            None => std::env::remove_var(self.key),
        }
    }
}

/// The `SharedArgs` the replaced subprocess produced, field for field.
///
/// It invoked `ccusage <provider> daily --json --breakdown --order desc
/// [--since X] [--until Y]` and nothing else, so every other field keeps the
/// upstream default: `mode: Auto` (prefer a pre-baked `costUSD` over
/// recomputing), `timezone: None` (local time), `single_thread: false`,
/// `debug: false`. `json: true` is what `--json` sets, and it also suppresses
/// the progress spinner, which is what we want in a GUI process.
fn daily_shared_args(since: Option<&str>, until: Option<&str>) -> SharedArgs {
    SharedArgs {
        since: since.map(str::to_string),
        until: until.map(str::to_string),
        json: true,
        mode: CostMode::Auto,
        debug_samples: 5,
        order: SortOrder::Desc,
        breakdown: true,
        offline: OFFLINE_PRICING,
        ..SharedArgs::default()
    }
}

/// The JSON `ccusage claude daily --json --breakdown --order desc` prints.
///
/// Reproduces upstream `commands::run_daily`'s `--json` path (v20.0.2,
/// `commands/mod.rs:31-57`) for the non-`--instances` case: load, then
/// `filter_and_sort_summaries`, then `{daily, totals}`.
///
/// `home` overrides `CLAUDE_CONFIG_DIR` (the loader's own override channel);
/// `None` means "resolve the user's real Claude directories", exactly as the
/// bare CLI would.
pub fn claude_daily_json(
    home: Option<&Path>,
    since: Option<&str>,
    until: Option<&str>,
) -> std::result::Result<serde_json::Value, String> {
    let _lock = env_lock();
    let _home = EnvVarGuard::set("CLAUDE_CONFIG_DIR", home);

    let shared = daily_shared_args(since, until);
    let mut rows =
        claude_loader::load_daily_summaries(&shared, None, false).map_err(|err| err.to_string())?;
    claude_report::filter_and_sort_summaries(&mut rows, &shared, |row| {
        row.date.as_deref().unwrap_or_default()
    });

    Ok(json!({
        "daily": rows.iter().map(claude_report::summary_json).collect::<Vec<_>>(),
        "totals": claude_report::totals_json(&rows),
    }))
}

/// The JSON `ccusage codex daily --json --breakdown --order desc` prints.
///
/// Reproduces upstream `adapter::codex::run`'s `--json` path (v20.0.2,
/// `adapter/codex.rs:36-46`) — the same `load_groups` + `report_from_groups`
/// pair the CLI uses, so the Codex dedup key is the CLI's.
///
/// Note this deliberately does NOT go through `adapter::codex::report_json`
/// (`#[cfg(test)]` upstream): that is a test-only helper driven by
/// `load_codex_events`, whose dedup key includes `session_id` while the CLI's
/// (`insert_event_key`) does not. Feeding it would double-count events
/// duplicated across session files. See VENDORING.md, "Local modifications".
///
/// `home` overrides `CODEX_HOME`; `None` resolves the user's real Codex
/// directory.
pub fn codex_daily_json(
    home: Option<&Path>,
    since: Option<&str>,
    until: Option<&str>,
) -> std::result::Result<serde_json::Value, String> {
    let _lock = env_lock();
    let _home = EnvVarGuard::set("CODEX_HOME", home);

    let shared = daily_shared_args(since, until);
    let pricing = PricingMap::load(shared.offline, log_level() != Some(0));
    let groups = adapter::codex::load_groups(&shared, cli::AgentReportKind::Daily)
        .map_err(|err| err.to_string())?;
    let speed = adapter::codex::resolve_codex_speed(cli::CodexSpeed::Auto);

    Ok(adapter::codex::report_from_groups(
        &groups,
        cli::AgentReportKind::Daily,
        &pricing,
        speed,
    ))
}
