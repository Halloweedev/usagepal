//! Not vendored. Inert stand-ins for CLI-output-rendering symbols
//! `adapter/codex.rs` imports from upstream's `output.rs` (a banned file —
//! argument/JSON-output/table rendering, see VENDORING.md "What was
//! deliberately NOT taken"). `output.rs` itself is not vendored, so these
//! five functions are reproduced here as signature-only stubs.
//!
//! Reachability, checked against every call site in `codex.rs`:
//! - `wants_json` and `print_json_or_jq` are called only in
//!   `adapter::codex::run` (~codex.rs:36-47), to decide between JSON and
//!   table output and to print the JSON. `run` is never called from this
//!   crate or its tests.
//! - `format_currency`, `format_models_multiline`, and `format_number` are
//!   called only in `adapter::codex::print_table` (~codex.rs:549-659),
//!   formatting values for the terminal table. Also never called.
//!
//! None of these appear in `report_json`, `aggregate_events`,
//! `calculate_group_cost`, `filter_events_by_date`, or
//! `calculate_codex_model_cost` — the pure functions this vendoring exists
//! to make correct. (Contrast with `json_float` and `week_start` in
//! `report_support.rs`, which ARE reachable from that pure-data path and
//! are therefore ported verbatim, not stubbed.)
//!
//! Every body is `unimplemented!()` and would panic if ever actually
//! invoked.

use serde_json::Value;

use crate::{cli::SharedArgs, Result};

pub(crate) fn wants_json(_shared: &SharedArgs) -> bool {
    unimplemented!("CLI output stub: unreachable from the pure-data path")
}

pub(crate) fn print_json_or_jq(_value: Value, _jq: Option<&str>) -> Result<()> {
    unimplemented!("CLI output stub: unreachable from the pure-data path")
}

pub(crate) fn format_currency(_value: f64) -> String {
    unimplemented!("CLI output stub: unreachable from the pure-data path")
}

pub(crate) fn format_models_multiline(_models: &[String]) -> String {
    unimplemented!("CLI output stub: unreachable from the pure-data path")
}

pub(crate) fn format_number(_value: u64) -> String {
    unimplemented!("CLI output stub: unreachable from the pure-data path")
}
