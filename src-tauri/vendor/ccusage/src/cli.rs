//! NOT a vendored file. Upstream's `cli.rs` (2500+ lines) is the ccusage
//! argument parser and help-text renderer; it is out of scope per
//! VENDORING.md ("Do not take: cli.rs"). It also pulls in `config.rs` /
//! `config_schema.rs` (the config-file system, needing the `schemars` crate)
//! purely to compile its `impl Cli` parsing block, even though none of that
//! is reachable from the modules we vendor.
//!
//! `claude_loader.rs`, `codex_loader.rs`, and `cost.rs` are vendored
//! byte-identical and each does `use crate::cli::{CostMode, SharedArgs}` (or
//! a subset). To keep those files unedited, this module reproduces upstream
//! `cli.rs` lines 42-186 verbatim (the `SharedArgs` struct, its
//! `with_defaults` helper, `CostMode`, and `SortOrder`) and nothing else —
//! no parsing, no `Cli`/`Command`, no config integration. See
//! VENDORING.md ("Local modifications") for the exact provenance.
//!
//! Field/type visibility here is `pub` rather than upstream's `pub(crate)`
//! — safe to widen because this file isn't vendored (there's no upstream
//! `pub(crate)` declaration being contradicted), and it means Task 3 doesn't
//! need to touch this file to construct/read a `SharedArgs` from the
//! `usagepal` crate.

use std::path::PathBuf;

#[derive(Clone, Default)]
pub struct SharedArgs {
    pub since: Option<String>,
    pub until: Option<String>,
    pub json: bool,
    pub mode: CostMode,
    pub debug: bool,
    pub debug_samples: usize,
    pub order: SortOrder,
    pub breakdown: bool,
    pub offline: bool,
    pub no_offline: bool,
    pub color: bool,
    pub no_color: bool,
    pub timezone: Option<String>,
    pub jq: Option<String>,
    pub config: Option<PathBuf>,
    pub compact: bool,
    pub single_thread: bool,
}

impl SharedArgs {
    #[allow(dead_code)]
    fn with_defaults() -> Self {
        Self {
            mode: CostMode::Auto,
            debug_samples: 5,
            order: SortOrder::Asc,
            ..Self::default()
        }
    }
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum CostMode {
    #[default]
    Auto,
    Calculate,
    Display,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum SortOrder {
    Desc,
    #[default]
    Asc,
}
