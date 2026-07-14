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

mod cli;
mod claude_loader;
mod codex_loader;
mod cost;
mod date_utils;
mod fast;
mod home;
mod logger;
mod pricing;
mod progress;
mod types;
mod utils;

use std::fmt;

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
pub(crate) use pricing::PricingMap;
pub(crate) use types::*;
pub(crate) use utils::{
    apply_total_token_fallback, json_value_u64, non_empty_json_string, total_usage_tokens,
};

// `cli.rs` is ours (not vendored), so its items are declared genuinely
// `pub` there — no widening-visibility problem, so a real `pub use` works.
pub use cli::{CostMode, SharedArgs, SortOrder};
