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

use std::{cell::RefCell, env::VarError, ffi::OsString, fmt, path::Path, sync::Arc};

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

// ---------------------------------------------------------------------------
// Pricing overlay channel
//
// `OFFLINE_PRICING` above keeps the loader off the network — permanently, and
// that is not negotiable: a probe worker must not block on GitHub. But
// embedded-only pricing has a cost of its own. Codex token-usage events carry
// no pre-baked `costUSD`, so `CostMode::Auto` falls through to
// `PricingMap::find`, and `cost.rs::calculate_cost_from_tokens` returns **0.0**
// on a miss — no error, no log. A model released after the embedded
// `litellm-pricing-fallback.json` snapshot therefore shows zero spend,
// silently. (Claude has the same hole for any entry whose `costUSD` is
// absent.)
//
// So the fetch happens *outside* this crate — in `usagepal`'s
// `plugin_engine::pricing_cache`, which owns the 24h disk cache and the
// background refresh — and the resulting LiteLLM JSON is handed to the loader
// as an overlay on `SharedArgs::pricing_overlay`. `load_pricing_map` below
// applies it exactly the way upstream's own `PricingMap::load(offline=false)`
// does: embedded snapshot first, then `load_json` over the top, so a fresher
// LiteLLM entry wins and everything else keeps the snapshot's value.
//
// With no overlay (`None`, the `SharedArgs` default) this is byte-for-byte
// today's embedded-only behavior — which is what `tests/ccusage_differential.rs`
// runs, and why that gate stays hermetic.
// ---------------------------------------------------------------------------

/// Builds the `PricingMap` for a load: whatever `PricingMap::load` gives for
/// `shared.offline` (embedded only, here), plus `shared.pricing_overlay` if the
/// caller supplied one.
///
/// This stands in for the bare `PricingMap::load(shared.offline, log)` call at
/// each of the vendored loaders' pricing-map construction sites, so that both
/// providers pick the overlay up from one place.
///
/// An overlay that yields **no models** leaves the embedded snapshot untouched —
/// and is reported, because that is a failure, not a no-op. `load_json` has no
/// other way to say "I could not use this": it returns the number of models it
/// loaded, and `0` means the JSON was unparseable or carried nothing priceable.
/// Upstream warns at exactly this point (`pricing.rs::load`, on the JSON it
/// fetched itself); so do we, on the JSON we were handed. Callers still get a
/// working map — the embedded snapshot — but the degradation is on the record
/// instead of being swallowed.
pub(crate) fn load_pricing_map(shared: &SharedArgs, log: bool) -> PricingMap {
    let mut map = PricingMap::load(shared.offline, log);
    if let Some(overlay) = shared.pricing_overlay.as_deref() {
        if map.load_json(overlay) == 0 {
            // `::log`, not `log` — this function's own `log: bool` parameter is
            // in the value namespace and cannot shadow a crate path, but the
            // absolute path says so at a glance.
            ::log::warn!("LiteLLM pricing overlay loaded no models; using embedded pricing");
        }
    }
    map
}

/// USD **per token**, as LiteLLM stores them. The caller converts.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TokenRates {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_read: f64,
}

/// A resolved price table: the embedded snapshot, optionally overlaid with
/// fresher LiteLLM JSON. Wraps the vendored `PricingMap` (which is
/// `pub(crate)`, as upstream declared it) so `usagepal` can do model→rate
/// lookups through the same matcher the cost path uses.
pub struct PricingTable {
    map: PricingMap,
}

impl PricingTable {
    /// `overlay` is LiteLLM's `model_prices_and_context_window.json`, or `None`
    /// for the embedded snapshot alone. An unparseable overlay is ignored (the
    /// snapshot still prices).
    pub fn new(overlay: Option<&str>) -> Self {
        let mut map = PricingMap::load_embedded();
        if let Some(overlay) = overlay {
            map.load_json(overlay);
        }
        Self { map }
    }

    /// `None` when the model has no known price — never a zeroed rate.
    pub fn lookup(&self, model: &str) -> Option<TokenRates> {
        self.map.find(model).map(|pricing| TokenRates {
            input: pricing.input,
            output: pricing.output,
            cache_write: pricing.cache_create,
            cache_read: pricing.cache_read,
        })
    }
}

// ---------------------------------------------------------------------------
// Home override channel
//
// The vendored path resolvers take a home directory override from an
// environment variable — `claude_loader::claude_paths` reads
// `CLAUDE_CONFIG_DIR`, `codex_loader::codex_home_paths` reads `CODEX_HOME`.
// That was fine for the `bunx ccusage` subprocess this crate replaces: it set
// those variables on the *child*.
//
// In-process it is not. `setenv`/`getenv` are not thread-safe, this is a
// Tauri/Cocoa/WebKit process where non-Rust threads call `getenv` with no
// synchronization we could participate in, and `usagepal` itself reads the
// environment concurrently (`host_api::read_env_from_process` backs a
// whitelisted JS API whose whitelist literally includes `CODEX_HOME` and
// `CLAUDE_CONFIG_DIR`). A Rust-side mutex cannot make that sound — which is
// exactly why `std::env::set_var` became `unsafe` in edition 2024. So this
// crate never mutates the process environment.
//
// Instead the two resolvers call `crate::env_var` instead of `std::env::var`
// (a one-token edit each; recorded in VENDORING.md under "Local
// modifications"), and `env_var` consults this thread-local first. The
// override is set by the wrapper, on the thread that runs the load, and is
// cleared when the wrapper returns. Both resolvers are called synchronously on
// that same thread — `claude_paths()` at the top of
// `load_daily_summaries_inner`, `codex_usage_paths()` at the top of
// `adapter::codex::load_groups`, both before any `thread::scope` — so the
// override is always visible where it is read, and is invisible to every other
// thread in the process.
// ---------------------------------------------------------------------------

thread_local! {
    static HOME_OVERRIDE: RefCell<Option<(&'static str, OsString)>> = const { RefCell::new(None) };
}

/// Drop-in for `std::env::var`, called by the vendored path resolvers in place
/// of it. Returns the thread-local home override when one is set for `key`,
/// and otherwise defers to the real environment (so a user's own
/// `CLAUDE_CONFIG_DIR` still works when no override is in effect, exactly as
/// the bare CLI would).
///
/// Non-UTF-8 overrides surface as `VarError::NotUnicode`, the same error
/// `std::env::var` would give for a non-UTF-8 environment value — the
/// resolvers' `if let Ok(..)` then falls through to the default home
/// directory, unchanged.
pub(crate) fn env_var(key: &str) -> std::result::Result<String, VarError> {
    let overridden = HOME_OVERRIDE.with(|slot| match &*slot.borrow() {
        Some((override_key, value)) if *override_key == key => Some(value.clone()),
        _ => None,
    });
    match overridden {
        Some(value) => value.into_string().map_err(VarError::NotUnicode),
        None => std::env::var(key),
    }
}

/// Sets the calling thread's home override for the lifetime of the guard.
struct HomeOverrideGuard;

impl HomeOverrideGuard {
    fn set(key: &'static str, value: Option<&Path>) -> Self {
        HOME_OVERRIDE.with(|slot| {
            *slot.borrow_mut() = value.map(|path| (key, path.as_os_str().to_os_string()));
        });
        Self
    }
}

impl Drop for HomeOverrideGuard {
    fn drop(&mut self) {
        HOME_OVERRIDE.with(|slot| {
            *slot.borrow_mut() = None;
        });
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
///
/// `pricing_overlay` has no upstream counterpart; see "Pricing overlay
/// channel" above.
fn daily_shared_args(
    since: Option<&str>,
    until: Option<&str>,
    pricing_overlay: Option<&str>,
) -> SharedArgs {
    SharedArgs {
        since: since.map(str::to_string),
        until: until.map(str::to_string),
        json: true,
        mode: CostMode::Auto,
        debug_samples: 5,
        order: SortOrder::Desc,
        breakdown: true,
        offline: OFFLINE_PRICING,
        pricing_overlay: pricing_overlay.map(Arc::from),
        ..SharedArgs::default()
    }
}

/// The JSON `ccusage claude daily --json --breakdown --order desc` prints.
///
/// Reproduces upstream `commands::run_daily`'s `--json` path (v20.0.2,
/// `commands/mod.rs:31-57`) for the non-`--instances` case: load, then
/// `filter_and_sort_summaries`, then `{daily, totals}`.
///
/// `home` overrides `CLAUDE_CONFIG_DIR` for this thread only (see "Home
/// override channel" above); `None` means "resolve the user's real Claude
/// directories", exactly as the bare CLI would.
///
/// `pricing_overlay` is fresher LiteLLM JSON to lay over the embedded pricing
/// snapshot (see "Pricing overlay channel"); `None` is embedded-only.
pub fn claude_daily_json(
    home: Option<&Path>,
    since: Option<&str>,
    until: Option<&str>,
    pricing_overlay: Option<&str>,
) -> std::result::Result<serde_json::Value, String> {
    let _home = HomeOverrideGuard::set("CLAUDE_CONFIG_DIR", home);

    let shared = daily_shared_args(since, until, pricing_overlay);
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
/// `home` overrides `CODEX_HOME` for this thread only (see "Home override
/// channel" above); `None` resolves the user's real Codex directory.
///
/// `pricing_overlay` is fresher LiteLLM JSON to lay over the embedded pricing
/// snapshot (see "Pricing overlay channel"); `None` is embedded-only. This is
/// the provider it matters most for: Codex events carry no pre-baked cost, so
/// the pricing map is the *only* source of a Codex dollar figure.
pub fn codex_daily_json(
    home: Option<&Path>,
    since: Option<&str>,
    until: Option<&str>,
    pricing_overlay: Option<&str>,
) -> std::result::Result<serde_json::Value, String> {
    let _home = HomeOverrideGuard::set("CODEX_HOME", home);

    let shared = daily_shared_args(since, until, pricing_overlay);
    let pricing = load_pricing_map(&shared, log_level() != Some(0));
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
