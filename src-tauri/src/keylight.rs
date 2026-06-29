//! Keylight licensing: build-time config + launch reporting.
//!
//! Every identifier below is a *publishable* client value — NOT a secret. The
//! tenant's Ed25519 private signing key never leaves Keylight's servers. Values
//! are injected at build time from the repo-root `.env` via `build.rs`
//! (see `KEYLIGHT_*` in `.env.example`). Empty placeholders keep the app
//! building and running before the donation product exists.

use keylight::{Keylight, KeylightConfig, KeylessState, LicenseState};

const TENANT: &str = match option_env!("KEYLIGHT_TENANT") { Some(v) => v, None => "" };
const PRODUCT: &str = match option_env!("KEYLIGHT_PRODUCT") { Some(v) => v, None => "" };
const SDK_KEY: &str = match option_env!("KEYLIGHT_SDK_KEY") { Some(v) => v, None => "" };
const PUBKEY_KID: &str = match option_env!("KEYLIGHT_PUBKEY_KID") { Some(v) => v, None => "" };
const PUBKEY_B64: &str = match option_env!("KEYLIGHT_PUBKEY") { Some(v) => v, None => "" };

/// Entitlement a donor key must carry to unlock supporter features. Must match
/// the feature configured on the Keylight product.
pub const SUPPORTER_ENTITLEMENT: &str = "supporter";

/// Build the plugin config, pinning the trusted public key so license
/// verification works fully offline when the key is configured.
pub fn config() -> KeylightConfig {
    let builder = KeylightConfig::builder(TENANT, PRODUCT, SDK_KEY).max_offline_days(14);
    let builder = if !PUBKEY_KID.is_empty() && !PUBKEY_B64.is_empty() {
        builder.trusted_key(PUBKEY_KID, PUBKEY_B64)
    } else {
        builder
    };
    builder.build()
}

/// Run once per launch on a background thread. Free/unlicensed devices send the
/// anonymous keyless beacon (the SDK debounces it to ≤1 ping/24h); donor devices
/// refresh their license instead. `report_keyless_state` returns nothing and
/// swallows its own errors, so there is nothing to handle there.
pub fn report_on_launch() {
    if SDK_KEY.is_empty() {
        return; // not configured yet — nothing to report
    }
    let Ok(kl) = Keylight::new(config()) else {
        log::warn!("keylight: client init failed");
        return;
    };
    match kl.state() {
        LicenseState::Licensed | LicenseState::Limited => {
            let _ = kl.check_on_launch();
        }
        _ => kl.report_keyless_state(KeylessState::FreeTier),
    }
}
