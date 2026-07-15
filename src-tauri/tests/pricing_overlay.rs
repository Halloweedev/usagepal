//! The pricing cache's LiteLLM overlay must reach the *vendored ccusage cost
//! path*, not just `host.pricing`.
//!
//! Why this test exists: the vendored loader is pinned offline
//! (`OFFLINE_PRICING = true`), so it prices from its embedded LiteLLM snapshot
//! alone. Codex token-usage events carry no pre-baked `costUSD`, so a model the
//! snapshot has never heard of falls through `PricingMap::find` and
//! `calculate_cost_from_tokens` returns **0.0** — no error, no log. The user
//! sees zero spend for a model they are paying for. Claude has the same hole
//! for any entry without a `costUSD`.
//!
//! The overlay closes it. These tests pin both halves: with `None` the loader
//! behaves exactly as it does today (which is what the differential gate
//! requires), and with an overlay the new price actually lands in the dollar
//! figure.

use std::fs;
use std::path::Path;

use usagepal_lib::plugin_engine::ccusage::{query_daily, Provider};
// The model name, the overlay JSON and the self-cleaning temp dir are shared
// with `pricing_cache`'s own unit tests, so the two suites cannot drift apart.
use usagepal_lib::plugin_engine::pricing_cache::test_fixtures::{
    temp_dir, TempDir, OVERLAY_JSON as OVERLAY, OVERLAY_ONLY_MODEL,
};

fn write(path: &Path, contents: &str) {
    fs::create_dir_all(path.parent().expect("parent")).expect("create dirs");
    fs::write(path, contents).expect("write fixture");
}

/// Upstream names the total differently per provider: `totals.costUSD` for
/// Codex, `totals.totalCost` for Claude. Both are reproduced verbatim by the
/// vendored report builders, so read whichever the report actually carries.
fn total_cost(report: &serde_json::Value) -> f64 {
    let totals = &report["totals"];
    totals["costUSD"]
        .as_f64()
        .or_else(|| totals["totalCost"].as_f64())
        .expect("the report carries a total cost")
}

/// 100 uncached input + 20 cached input + 50 output, on a model no embedded
/// snapshot prices.
fn codex_home() -> TempDir {
    let home = temp_dir("overlay-codex");
    write(
        &home.join("sessions").join("session.jsonl"),
        &format!(
            r#"{{"timestamp":"2026-07-10T10:00:00.000Z","type":"event_msg","payload":{{"type":"token_count","info":{{"model":"{}","last_token_usage":{{"input_tokens":100,"cached_input_tokens":20,"output_tokens":50,"reasoning_output_tokens":0,"total_tokens":150}},"total_token_usage":{{"input_tokens":100,"cached_input_tokens":20,"output_tokens":50,"reasoning_output_tokens":0,"total_tokens":150}}}}}}}}
"#,
            OVERLAY_ONLY_MODEL
        ),
    );
    home
}

#[test]
fn codex_prices_an_unknown_model_at_zero_without_the_overlay() {
    let home = codex_home();

    let report = query_daily(Provider::Codex, Some(&home), None, None, None).expect("loader ran");

    assert_eq!(
        total_cost(&report),
        0.0,
        "this is the silent $0 the overlay exists to fix — if it ever stops \
         being 0.0, the embedded snapshot learned this model and the fixture \
         needs a fresher unknown one"
    );
    assert_eq!(
        report["totals"]["totalTokens"].as_u64(),
        Some(150),
        "the tokens are counted either way; only the price is missing"
    );
}

#[test]
fn codex_prices_an_unknown_model_from_the_overlay() {
    let home = codex_home();

    let report =
        query_daily(Provider::Codex, Some(&home), None, None, Some(OVERLAY)).expect("loader ran");

    // ccusage charges Codex's cached input at the cache-read rate when LiteLLM
    // states one: 80 × $2/M + 20 × $0.2/M + 50 × $10/M.
    let expected = 80.0 * 0.000002 + 20.0 * 0.0000002 + 50.0 * 0.00001;
    assert!(
        (total_cost(&report) - expected).abs() < 1e-12,
        "expected {}, got {}",
        expected,
        total_cost(&report)
    );
}

#[test]
fn claude_prices_an_unknown_model_from_the_overlay() {
    let home = temp_dir("overlay-claude");
    // No `costUSD` on the entry, so `CostMode::Auto` must reach the pricing map.
    write(
        &home.join("projects").join("proj").join("session.jsonl"),
        &format!(
            r#"{{"timestamp":"2026-07-10T10:00:00.000Z","sessionId":"s1","requestId":"r1","version":"2.0.1","message":{{"id":"m1","model":"{}","usage":{{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":20,"cache_read_input_tokens":10}}}}}}
"#,
            OVERLAY_ONLY_MODEL
        ),
    );

    let without = query_daily(Provider::Claude, Some(&home), None, None, None).expect("loader ran");
    assert_eq!(
        total_cost(&without),
        0.0,
        "embedded-only pricing cannot price this model"
    );

    let with =
        query_daily(Provider::Claude, Some(&home), None, None, Some(OVERLAY)).expect("loader ran");

    // 100 × $2/M + 50 × $10/M + 20 × $2.5/M + 10 × $0.2/M.
    let expected = 100.0 * 0.000002 + 50.0 * 0.00001 + 20.0 * 0.0000025 + 10.0 * 0.0000002;
    assert!(
        (total_cost(&with) - expected).abs() < 1e-12,
        "expected {}, got {}",
        expected,
        total_cost(&with)
    );
}

#[test]
fn an_unparseable_overlay_leaves_the_embedded_prices_intact() {
    let home = temp_dir("overlay-garbage");
    write(
        &home.join("sessions").join("session.jsonl"),
        r#"{"timestamp":"2026-07-10T10:00:00.000Z","type":"event_msg","payload":{"type":"token_count","info":{"model":"gpt-5.3-codex","last_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":50,"reasoning_output_tokens":0,"total_tokens":150},"total_token_usage":{"input_tokens":100,"cached_input_tokens":20,"output_tokens":50,"reasoning_output_tokens":0,"total_tokens":150}}}}
"#,
    );

    let embedded = query_daily(Provider::Codex, Some(&home), None, None, None).expect("loader ran");
    let garbage = query_daily(Provider::Codex, Some(&home), None, None, Some("not json"))
        .expect("loader ran");

    assert!(total_cost(&embedded) > 0.0, "gpt-5.3-codex is embedded");
    assert_eq!(
        total_cost(&garbage),
        total_cost(&embedded),
        "a bad overlay must not zero out prices we already had"
    );
}
