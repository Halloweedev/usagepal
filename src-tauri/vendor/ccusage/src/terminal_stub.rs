//! Not vendored. Inert stand-ins for the terminal-rendering symbols
//! `adapter/codex.rs` imports from upstream's `main.rs`
//! (`pub(crate) use ccusage_terminal::{Align, Color, SimpleTable};`) and
//! from `main.rs` itself (`color`, `print_box_title`, both of which just
//! delegate to the `ccusage-terminal` workspace crate). That crate is a
//! separate workspace member, is not part of this repo, and is exactly the
//! "terminal rendering" category VENDORING.md's cut-line analysis excludes.
//!
//! Reachability: all four symbols here are referenced ONLY inside
//! `adapter::codex::print_table` (called only from `adapter::codex::run`,
//! ~codex.rs:549-659) — the CLI-rendering half of that file. Neither
//! function is called anywhere else in this crate or by `codex.rs`'s own
//! `#[cfg(test)] mod tests`, which exercises `report_json`,
//! `load_groups_from_directory`, and `calculate_codex_model_cost` directly
//! and never touches `run`/`print_table`. So none of the bodies below can
//! ever execute; they only need to type-check the call sites in
//! `print_table`. Every body is `unimplemented!()` and would panic if that
//! ever stopped being true.
//!
//! Signatures are trimmed to exactly what `codex.rs`'s call sites need
//! (e.g. `&crate::cli::SharedArgs` directly, instead of upstream's
//! `impl Into<TerminalStyle>` — `TerminalStyle` is itself a
//! `ccusage-terminal` type we have no reason to reintroduce for code that
//! never runs).

use crate::cli::SharedArgs;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Align {
    Left,
    Right,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Color {
    Blue,
    Green,
    Grey,
    Red,
    Yellow,
}

pub(crate) struct SimpleTable;

impl SimpleTable {
    pub(crate) fn new(_headers: Vec<&str>, _aligns: Vec<Align>, _shared: &SharedArgs) -> Self {
        unimplemented!("terminal rendering stub: unreachable from the pure-data path")
    }

    pub(crate) fn with_date_compaction(self, _compact_dates: bool) -> Self {
        unimplemented!("terminal rendering stub: unreachable from the pure-data path")
    }

    pub(crate) fn push(&mut self, _row: Vec<String>) {
        unimplemented!("terminal rendering stub: unreachable from the pure-data path")
    }

    pub(crate) fn separator(&mut self) {
        unimplemented!("terminal rendering stub: unreachable from the pure-data path")
    }

    pub(crate) fn print(&self) {
        unimplemented!("terminal rendering stub: unreachable from the pure-data path")
    }
}

pub(crate) fn color(_shared: &SharedArgs, _value: impl AsRef<str>, _color: Color) -> String {
    unimplemented!("terminal rendering stub: unreachable from the pure-data path")
}

pub(crate) fn print_box_title(_title: &str, _shared: &SharedArgs) {
    unimplemented!("terminal rendering stub: unreachable from the pure-data path")
}
