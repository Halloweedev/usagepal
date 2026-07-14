//! Proves the vendored ccusage core produces byte-identical output to the
//! pinned upstream binary (ccusage@20.0.2) over a fixture corpus.
//!
//! This is the acceptance gate for the vendor cutover. It is only meaningful
//! while semantics are unchanged — the Phase 3 correctness fixes deliberately
//! break it, and each one updates the expected fixture with a named reason.
//!
//! Day bucketing is local-time, not UTC, in upstream ccusage. Both sides of
//! this comparison must pin TZ=UTC: the reference fixtures were captured with
//! `TZ=UTC npx ccusage@20.0.2 ...`, and this test process pins TZ=UTC itself
//! so it passes identically regardless of the CI runner's local timezone.

use std::path::{Path, PathBuf};

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/ccusage")
}

fn force_utc() {
    // SAFETY: test binaries are single-threaded at this point (called at the
    // start of each #[test] before any other env access), and upstream's day
    // bucketing is local-time — TZ must be pinned for reproducible comparison.
    unsafe {
        std::env::set_var("TZ", "UTC");
    }
}

#[test]
fn vendored_claude_loader_matches_upstream_binary() {
    force_utc();
    let home = fixtures().join("claude");
    let expected: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(fixtures().join("claude-expected.json"))
            .expect("checked-in reference output from ccusage@20.0.2"),
    )
    .expect("reference output is valid JSON");

    let actual = usagepal_lib::plugin_engine::ccusage::query_daily(
        usagepal_lib::plugin_engine::ccusage::Provider::Claude,
        Some(&home),
        None,
        None,
    )
    .expect("vendored loader ran");

    assert_eq!(
        actual, expected,
        "vendored loader diverged from ccusage@20.0.2 — this is a port bug, not an upstream fix"
    );
}

#[test]
fn vendored_codex_loader_matches_upstream_binary() {
    force_utc();
    let home = fixtures().join("codex");
    let expected: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(fixtures().join("codex-expected.json"))
            .expect("checked-in reference output from ccusage@20.0.2"),
    )
    .expect("reference output is valid JSON");

    let actual = usagepal_lib::plugin_engine::ccusage::query_daily(
        usagepal_lib::plugin_engine::ccusage::Provider::Codex,
        Some(&home),
        None,
        None,
    )
    .expect("vendored loader ran");

    assert_eq!(
        actual, expected,
        "vendored loader diverged from ccusage@20.0.2 — this is a port bug, not an upstream fix"
    );
}
