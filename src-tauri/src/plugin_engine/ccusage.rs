//! Adapter over the vendored ccusage core. All local behavior lives here;
//! `vendor/ccusage` is byte-identical to upstream apart from the edits its
//! `VENDORING.md` records. See that file before changing anything under
//! `vendor/`.
//!
//! This replaces a `bunx ccusage@20.0.2 <provider> daily --json --breakdown
//! --order desc` subprocess. `query_daily` returns the same JSON that
//! subprocess printed on stdout, so `ctx.host.ccusage.query()` — and the
//! Claude and Codex plugins that call it — are unaffected.

use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    Claude,
    Codex,
}

/// Run the daily-summary load in-process and return the same JSON shape the
/// `ccusage <provider> daily --json --breakdown --order desc` CLI emitted.
///
/// `home` overrides the provider's usage directory (what the subprocess passed
/// as `CLAUDE_CONFIG_DIR` / `CODEX_HOME` on the child's environment);
/// `None` resolves the user's real directories. `since`/`until` are inclusive
/// `YYYYMMDD` local-date bounds.
///
/// `pricing_overlay` is LiteLLM JSON from [`super::pricing_cache`], laid over
/// the loader's embedded pricing snapshot. The loader itself never touches the
/// network (`OFFLINE_PRICING`), so this is the only way a price newer than the
/// snapshot reaches a Claude or Codex dollar figure — and Codex has no other
/// source of one at all, since its events carry no pre-baked cost. `None` is
/// embedded-only pricing, which is what `tests/ccusage_differential.rs` passes
/// to keep that gate hermetic.
pub fn query_daily(
    provider: Provider,
    home: Option<&Path>,
    since: Option<&str>,
    until: Option<&str>,
    pricing_overlay: Option<&str>,
) -> Result<serde_json::Value, String> {
    match provider {
        Provider::Claude => ccusage_vendor::claude_daily_json(home, since, until, pricing_overlay),
        Provider::Codex => ccusage_vendor::codex_daily_json(home, since, until, pricing_overlay),
    }
}
