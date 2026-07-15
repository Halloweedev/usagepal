//! Not vendored, but NOT a stub either — the same category as
//! `report_support.rs`. These four functions are the Claude half of what
//! upstream's `commands::run_daily` does *after* `load_daily_summaries`
//! returns, and they are reproduced here **verbatim** from upstream (not
//! reinvented), because getting them wrong silently rewrites every user's
//! spend history.
//!
//! Upstream `commands/mod.rs::run_daily` (v20.0.2) is, for the `--json`
//! non-`--instances` path this crate exposes:
//!
//! ```text
//! let mut rows = load_daily_summaries(&shared, None, false)?;
//! filter_and_sort_summaries(&mut rows, &shared, |row| row.date.as_deref().unwrap_or_default());
//! json!({
//!     "daily": rows.iter().map(summary_json).collect::<Vec<_>>(),
//!     "totals": totals_json(&rows),
//! })
//! ```
//!
//! `load_daily_summaries` is vendored byte-identical, but the four functions
//! it is composed with live in upstream `output.rs` / `summary.rs`, neither of
//! which is vendored (both are CLI-rendering files, out of scope per
//! VENDORING.md). Only the pure, self-contained functions on the JSON path are
//! reproduced here:
//!
//! - `summary_json`, verbatim from upstream `output.rs`. Note this is NOT
//!   equivalent to `serde_json::to_value(row)`: it emits `totalTokens` (a
//!   computed method, not a serde field), omits `credits` entirely when
//!   `None` (serde would emit `null`), and excludes `messageCount`/`versions`.
//! - `totals_json`, verbatim from upstream `output.rs`. Sums `extra_total_tokens`,
//!   which is `#[serde(skip_serializing)]` on `UsageSummary` and therefore
//!   invisible to serde.
//! - `filter_and_sort_summaries` + `sort_summaries`, verbatim from upstream
//!   `summary.rs`. `load_daily_summaries` does neither internally — it groups
//!   through a `BTreeMap` (ascending), so `--since`/`--until` filtering and
//!   `--order desc` are applied here or not at all.
//!
//! Their only dependencies (`UsageSummary`, `SharedArgs`, `SortOrder`,
//! `serde_json`) are already in this crate, so nothing further needed porting.
//! These need `pub(crate)` access to `UsageSummary`'s fields, which is why they
//! live inside this crate rather than in the `usagepal` adapter.

use serde_json::{json, Value};

use crate::{
    cli::{SharedArgs, SortOrder},
    UsageSummary,
};

// Verbatim from upstream `output.rs::summary_json`.
pub(crate) fn summary_json(row: &UsageSummary) -> Value {
    let mut value = json!({
        "inputTokens": row.input_tokens,
        "outputTokens": row.output_tokens,
        "cacheCreationTokens": row.cache_creation_tokens,
        "cacheReadTokens": row.cache_read_tokens,
        "totalTokens": row.total_tokens(),
        "totalCost": row.total_cost,
        "modelsUsed": row.models_used,
        "modelBreakdowns": row.model_breakdowns,
    });
    if let Some(obj) = value.as_object_mut() {
        if let Some(date) = &row.date {
            obj.insert("date".to_string(), json!(date));
        }
        if let Some(month) = &row.month {
            obj.insert("month".to_string(), json!(month));
        }
        if let Some(week) = &row.week {
            obj.insert("week".to_string(), json!(week));
        }
        if let Some(project) = &row.project {
            obj.insert("project".to_string(), json!(project));
        }
        if let Some(credits) = row.credits {
            obj.insert("credits".to_string(), json!(credits));
        }
    }
    value
}

// Verbatim from upstream `output.rs::totals_json`.
pub(crate) fn totals_json(rows: &[UsageSummary]) -> Value {
    let input = rows.iter().map(|row| row.input_tokens).sum::<u64>();
    let output = rows.iter().map(|row| row.output_tokens).sum::<u64>();
    let cache_create = rows
        .iter()
        .map(|row| row.cache_creation_tokens)
        .sum::<u64>();
    let cache_read = rows.iter().map(|row| row.cache_read_tokens).sum::<u64>();
    let extra = rows.iter().map(|row| row.extra_total_tokens).sum::<u64>();
    let mut value = json!({
        "inputTokens": input,
        "outputTokens": output,
        "cacheCreationTokens": cache_create,
        "cacheReadTokens": cache_read,
        "totalTokens": input + output + cache_create + cache_read + extra,
        "totalCost": rows.iter().map(|row| row.total_cost).sum::<f64>(),
    });
    let credits = rows.iter().filter_map(|row| row.credits).sum::<f64>();
    if credits > 0.0 {
        value["credits"] = json!(credits);
    }
    value
}

// Verbatim from upstream `summary.rs::filter_and_sort_summaries`.
pub(crate) fn filter_and_sort_summaries<F>(
    rows: &mut Vec<UsageSummary>,
    shared: &SharedArgs,
    date_fn: F,
) where
    F: Fn(&UsageSummary) -> &str,
{
    if shared.since.is_some() || shared.until.is_some() {
        rows.retain(|row| {
            let date = date_fn(row).replace('-', "");
            shared.since.as_ref().is_none_or(|since| &date >= since)
                && shared.until.as_ref().is_none_or(|until| &date <= until)
        });
    }
    sort_summaries(rows, &shared.order, date_fn);
}

// Verbatim from upstream `summary.rs::sort_summaries`.
pub(crate) fn sort_summaries<F>(rows: &mut [UsageSummary], order: &SortOrder, date_fn: F)
where
    F: Fn(&UsageSummary) -> &str,
{
    rows.sort_by(|a, b| match order {
        SortOrder::Asc => date_fn(a).cmp(date_fn(b)),
        SortOrder::Desc => date_fn(b).cmp(date_fn(a)),
    });
}
