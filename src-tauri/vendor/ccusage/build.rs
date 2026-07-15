//! NOT a vendored file. Upstream's own `build.rs` does two things: (1)
//! generates `cli-help.rs` from `src/cli-help.json` for `cli.rs`'s help-text
//! functions, and (2) fetches the latest LiteLLM pricing snapshot from the
//! network at build time (falling back to the checked-in
//! `litellm-pricing-fallback.json` on failure, or unconditionally when
//! `CCUSAGE_SKIP_PRICING_FETCH` is set), writing the result to
//! `$OUT_DIR/litellm-pricing.json` for `pricing.rs`'s
//! `include_str!(concat!(env!("OUT_DIR"), "/litellm-pricing.json"))`.
//!
//! We don't vendor `cli.rs` or `cli-help.json`, so (1) is moot.
//!
//! For (2): a desktop app's build should not depend on a live GitHub fetch
//! succeeding (or on non-determinism from whatever LiteLLM happens to
//! publish that day) — so this build script always takes the
//! `CCUSAGE_SKIP_PRICING_FETCH` path: it copies the vendored, checked-in
//! `src/litellm-pricing-fallback.json` to `$OUT_DIR/litellm-pricing.json`
//! verbatim. `pricing.rs` already loads `FALLBACK_PRICING_JSON` (that same
//! file, embedded separately at its own `include_str!`) on top of this at
//! runtime regardless, so no model coverage is lost — this only forgoes the
//! smaller, network-refreshed, curated subset upstream's build.rs produces
//! for `BUILD_TIME_PRICING_JSON`. See VENDORING.md, "Local modifications".

use std::{env, fs, path::PathBuf};

const FALLBACK_PRICING_JSON: &str = "src/litellm-pricing-fallback.json";
const OUT_PRICING_JSON: &str = "litellm-pricing.json";

fn main() {
    println!("cargo:rerun-if-changed={FALLBACK_PRICING_JSON}");

    let out_dir = PathBuf::from(env::var_os("OUT_DIR").expect("OUT_DIR is set by cargo"));
    let pricing_json =
        fs::read_to_string(FALLBACK_PRICING_JSON).expect("read fallback pricing snapshot");
    fs::write(out_dir.join(OUT_PRICING_JSON), pricing_json)
        .expect("write build-time pricing snapshot");
}
