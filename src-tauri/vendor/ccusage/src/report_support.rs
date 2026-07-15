//! Not vendored, but NOT a stub either — unlike `terminal_stub.rs` and
//! `output_stub.rs`, the two functions here are genuinely reachable from
//! `adapter/codex.rs`'s pure-data path and are ported verbatim from
//! upstream (not reinvented), because getting them wrong silently produces
//! wrong dollar figures or wrong day/week buckets.
//!
//! - `json_float`, verbatim from upstream `output.rs`
//!   (`pub(crate) fn json_float`): called by `codex.rs`'s `group_json` and
//!   `totals_json`, both called from `report_from_groups`, which
//!   `report_json` (one of the explicitly pure/correctness-critical
//!   functions named in the Task 2 review) calls directly. Reachable, so
//!   it must be correct, not `unimplemented!()`.
//! - `week_start`, verbatim from upstream `summary.rs`
//!   (`pub(crate) fn week_start`): called by `codex.rs`'s
//!   `aggregate_events` itself (for `AgentReportKind::Weekly`), one of the
//!   five functions the review named explicitly. Its own dependencies,
//!   `parse_iso_date`/`format_naive_date`/`IsoDate::weekday_from_sunday`,
//!   are already vendored byte-identical in `date_utils.rs`, so nothing
//!   further needed porting.
//!
//! `output.rs` and `summary.rs` as whole files remain out of scope (CLI
//! output rendering / summary-table assembly per VENDORING.md); only these
//! two already-self-contained pure functions are reproduced here, unedited
//! from upstream.

use serde_json::{json, Value};

use crate::{cli::WeekDay, format_naive_date, parse_iso_date};

// Verbatim from upstream `output.rs::json_float`.
pub(crate) fn json_float(value: f64) -> Value {
    if value.is_finite()
        && value.fract() == 0.0
        && value >= i64::MIN as f64
        && value <= i64::MAX as f64
    {
        json!(value as i64)
    } else {
        json!(value)
    }
}

// Verbatim from upstream `summary.rs::week_start`.
pub(crate) fn week_start(date: &str, start: WeekDay) -> Option<String> {
    let date = parse_iso_date(date)?;
    let start_num = match start {
        WeekDay::Sunday => 0,
        WeekDay::Monday => 1,
        WeekDay::Tuesday => 2,
        WeekDay::Wednesday => 3,
        WeekDay::Thursday => 4,
        WeekDay::Friday => 5,
        WeekDay::Saturday => 6,
    };
    let day = date.weekday_from_sunday() as i64;
    let shift = (day - start_num + 7) % 7;
    Some(format_naive_date(date.checked_add_days(-shift)?))
}
