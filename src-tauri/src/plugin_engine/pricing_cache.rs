//! The app's one price source: a disk-cached copy of LiteLLM's
//! `model_prices_and_context_window.json`, floored by the pricing snapshot
//! embedded in the vendored ccusage crate.
//!
//! Layering, in order: **disk cache (24h TTL) → network → embedded snapshot.**
//! Upstream ccusage fetches LiteLLM on *every* invocation with no cache — fine
//! for a CLI a human runs by hand, not for a menubar app that probes every few
//! minutes. This is the one place we deliberately improve on upstream, and it
//! lives here, outside `vendor/`.
//!
//! Two consumers, one table:
//!
//! - [`PricingCache::rates_for`] — model → USD **per million tokens**, for
//!   `host.pricing` (Task 5) and the plugins that replace their hand-written
//!   tables with it (Task 6). LiteLLM stores per-token; the conversion happens
//!   here, once.
//! - [`PricingCache::overlay`] — the raw LiteLLM JSON, handed to the vendored
//!   ccusage loader on each Claude/Codex query. Without it the loader prices
//!   from the embedded snapshot alone, and since Codex events carry no
//!   pre-baked cost, a model newer than the snapshot renders as **$0 with no
//!   error** — the exact "silent $0" this work exists to kill.
//!
//! Two rules the rest of the app depends on:
//!
//! - **An unknown model is `None`, never `Some(zero)`.** A `$0` that means "we
//!   don't know" must not look like a `$0` that means "free".
//! - **A fetch failure is not an error state.** It logs at `warn` and falls
//!   through cache → embedded. Users on a plane still get prices. This is the
//!   degradation the design spec sanctions, not a silent fallback hiding a
//!   problem: nothing is hidden, and no number is invented.
//!
//! Refreshes never block a caller. `refresh_in_background` spawns; probes are
//! served from whatever is already in memory (stale-then-refresh).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, SystemTime};

use ccusage_vendor::PricingTable;

/// Upstream's URL, unchanged (`vendor/ccusage/src/pricing.rs`).
const LITELLM_PRICING_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How long to wait before trying again after a failed fetch. Without this, an
/// offline machine would re-attempt on every single lookup.
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(30 * 60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
/// LiteLLM's file is ~2 MB. This is a boundary guard, not a tight bound.
const MAX_RESPONSE_BYTES: u64 = 64 * 1024 * 1024;
const PER_MILLION: f64 = 1_000_000.0;

/// USD **per million tokens** — the unit every plugin pricing table already
/// assumes, so the arithmetic inside the plugins is unchanged.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelRates {
    pub input: f64,
    pub output: f64,
    pub cache_write: f64,
    pub cache_read: f64,
}

/// The resolved table plus the JSON it was built from, swapped as a unit so a
/// lookup never sees a half-applied refresh.
struct Snapshot {
    table: PricingTable,
    overlay: Option<Arc<str>>,
}

impl Snapshot {
    fn new(overlay: Option<Arc<str>>) -> Self {
        Self {
            table: PricingTable::new(overlay.as_deref()),
            overlay,
        }
    }
}

struct Inner {
    cache_file: PathBuf,
    endpoint: String,
    snapshot: RwLock<Arc<Snapshot>>,
    /// Earliest time a fetch may be attempted: `fetched_at + CACHE_TTL` for a
    /// cache we have, `now` for one we don't, `now + RETRY_AFTER_FAILURE` after
    /// a failure.
    next_attempt: RwLock<SystemTime>,
    refreshing: AtomicBool,
}

pub struct PricingCache {
    inner: Arc<Inner>,
}

impl PricingCache {
    /// `dir` is the app data dir; the cache lives under `<dir>/pricing/`.
    pub fn new(dir: &Path) -> Self {
        Self::with_endpoint(dir, LITELLM_PRICING_URL)
    }

    /// Same, against a caller-chosen endpoint. Tests use it to pin the fetch to
    /// a local address instead of GitHub.
    pub fn with_endpoint(dir: &Path, endpoint: &str) -> Self {
        let cache_file = dir.join("pricing").join("litellm-pricing.json");
        let cached = read_cache(&cache_file);
        let next_attempt = match cached.as_ref() {
            Some((_, fetched_at)) => *fetched_at + CACHE_TTL,
            None => SystemTime::now(),
        };
        let overlay = cached.map(|(json, _)| Arc::from(json));

        Self {
            inner: Arc::new(Inner {
                cache_file,
                endpoint: endpoint.to_string(),
                snapshot: RwLock::new(Arc::new(Snapshot::new(overlay))),
                next_attempt: RwLock::new(next_attempt),
                refreshing: AtomicBool::new(false),
            }),
        }
    }

    /// Rates for `model`, or `None` if no price is known for it.
    pub fn rates_for(&self, model: &str) -> Option<ModelRates> {
        self.snapshot().table.lookup(model).map(|rates| ModelRates {
            input: rates.input * PER_MILLION,
            output: rates.output * PER_MILLION,
            cache_write: rates.cache_write * PER_MILLION,
            cache_read: rates.cache_read * PER_MILLION,
        })
    }

    /// The LiteLLM JSON to overlay onto the vendored loader's embedded pricing,
    /// or `None` when we have never successfully fetched (the loader then uses
    /// the embedded snapshot alone, exactly as before).
    pub fn overlay(&self) -> Option<Arc<str>> {
        self.snapshot().overlay.clone()
    }

    /// Refreshes on another thread if the cache is due, and returns immediately.
    /// A probe is never made to wait on a network call.
    pub fn refresh_in_background(&self) {
        if !self.is_due() || self.inner.refreshing.swap(true, Ordering::AcqRel) {
            return;
        }
        let inner = Arc::clone(&self.inner);
        std::thread::spawn(move || {
            refresh(&inner);
            inner.refreshing.store(false, Ordering::Release);
        });
    }

    fn snapshot(&self) -> Arc<Snapshot> {
        Arc::clone(&self.inner.snapshot.read().expect("pricing snapshot lock"))
    }

    fn is_due(&self) -> bool {
        let next_attempt = *self
            .inner
            .next_attempt
            .read()
            .expect("pricing next-attempt lock");
        SystemTime::now() >= next_attempt
    }
}

/// Fetch, store, swap. A failure leaves the current snapshot in place and logs.
/// Returns whether a fresh table was installed (tests assert on it; callers
/// don't need to care).
fn refresh(inner: &Inner) -> bool {
    let json = match fetch(&inner.endpoint) {
        Ok(json) => json,
        Err(err) => {
            log::warn!(
                "LiteLLM pricing fetch failed ({}); serving cached/embedded prices",
                crate::plugin_engine::host_api::redact_log_message(&err)
            );
            *inner
                .next_attempt
                .write()
                .expect("pricing next-attempt lock") = SystemTime::now() + RETRY_AFTER_FAILURE;
            return false;
        }
    };

    write_cache(&inner.cache_file, &json);
    *inner.snapshot.write().expect("pricing snapshot lock") =
        Arc::new(Snapshot::new(Some(Arc::from(json))));
    *inner
        .next_attempt
        .write()
        .expect("pricing next-attempt lock") = SystemTime::now() + CACHE_TTL;
    log::info!("refreshed model pricing from LiteLLM");
    true
}

/// The response body, validated as JSON. Everything past this point may assume
/// the overlay parses — the vendored loader is handed only what got through
/// here (or what a previous run of it wrote to disk).
fn fetch(endpoint: &str) -> Result<String, String> {
    let mut builder = reqwest::blocking::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(FETCH_TIMEOUT);
    if let Some(resolved) = crate::config::get_resolved_proxy() {
        builder = builder.proxy(resolved.proxy.clone());
    }
    let client = builder.build().map_err(|err| err.to_string())?;

    let response = client.get(endpoint).send().map_err(|err| err.to_string())?;
    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status().as_u16()));
    }
    if response.content_length().unwrap_or(0) > MAX_RESPONSE_BYTES {
        return Err("response too large".to_string());
    }
    let body = response.text().map_err(|err| err.to_string())?;
    serde_json::from_str::<serde_json::Value>(&body)
        .map_err(|err| format!("response was not valid JSON: {}", err))?;
    Ok(body)
}

/// The cached JSON and when it was written. The file's mtime *is* the fetch
/// time — there is no sidecar and no wrapper envelope, so the file on disk is
/// byte-for-byte what LiteLLM served.
fn read_cache(cache_file: &Path) -> Option<(String, SystemTime)> {
    let fetched_at = fs::metadata(cache_file).ok()?.modified().ok()?;
    let json = fs::read_to_string(cache_file).ok()?;
    Some((json, fetched_at))
}

/// Writes via a temp file + rename, so a crash or a full disk can never leave a
/// truncated file that a later run would read back as pricing.
fn write_cache(cache_file: &Path, json: &str) {
    let Some(parent) = cache_file.parent() else {
        return;
    };
    if let Err(err) = fs::create_dir_all(parent) {
        log::warn!("failed to create pricing cache dir: {}", err);
        return;
    }
    let temp_file = cache_file.with_extension("json.tmp");
    if let Err(err) = fs::write(&temp_file, json) {
        log::warn!("failed to write pricing cache: {}", err);
        return;
    }
    if let Err(err) = fs::rename(&temp_file, cache_file) {
        log::warn!("failed to install pricing cache: {}", err);
        let _ = fs::remove_file(&temp_file);
    }
}

static GLOBAL: OnceLock<PricingCache> = OnceLock::new();

/// Called once at startup with the app data dir.
pub fn init(app_data_dir: &Path) {
    let _ = GLOBAL.set(PricingCache::new(app_data_dir));
    if let Some(cache) = global() {
        cache.refresh_in_background();
    }
}

/// `None` before [`init`] (tests, and any code path that runs without an app
/// data dir) — callers then get embedded pricing, which is the pre-Task-4
/// behavior.
pub fn global() -> Option<&'static PricingCache> {
    GLOBAL.get()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "usagepal-{}-{}-{}",
            name,
            std::process::id(),
            suffix
        ));
        fs::create_dir_all(&path).expect("create temp dir");
        path
    }

    /// A model no embedded-snapshot key can substring-match, so if it prices at
    /// all, it priced from the overlay.
    const OVERLAY_ONLY_MODEL: &str = "zzz-future-model-20260101";

    fn overlay_json() -> String {
        format!(
            r#"{{"{}": {{"input_cost_per_token": 0.000002, "output_cost_per_token": 0.00001,
                "cache_creation_input_token_cost": 0.0000025,
                "cache_read_input_token_cost": 0.0000002}}}}"#,
            OVERLAY_ONLY_MODEL
        )
    }

    fn assert_near(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {}, got {}",
            expected,
            actual
        );
    }

    fn write_cache_file(dir: &Path, json: &str) -> PathBuf {
        let cache_file = dir.join("pricing").join("litellm-pricing.json");
        fs::create_dir_all(cache_file.parent().expect("cache parent")).expect("create cache dir");
        fs::write(&cache_file, json).expect("write cache file");
        cache_file
    }

    fn backdate(cache_file: &Path, age: Duration) {
        let when = SystemTime::now() - age;
        let file = fs::File::options()
            .write(true)
            .open(cache_file)
            .expect("open cache file");
        file.set_times(fs::FileTimes::new().set_modified(when))
            .expect("backdate cache file");
    }

    /// A one-shot HTTP/1.1 responder on localhost. Keeps the "expired cache
    /// refetches" test hermetic — no GitHub, no network beyond the loopback.
    fn serve_once(body: String) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let url = format!("http://{}/pricing.json", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        });
        url
    }

    #[test]
    fn cold_cache_falls_back_to_the_embedded_snapshot() {
        let dir = temp_dir("pricing-cold");
        let cache = PricingCache::new(&dir);
        // No network, no cache file. The embedded snapshot must still price a
        // well-known model — a user on a plane still gets numbers.
        let rates = cache.rates_for("claude-sonnet-4-5-20250929");
        assert!(
            rates.is_some(),
            "embedded snapshot must price a known model"
        );
        assert!(rates.unwrap().input > 0.0);
    }

    #[test]
    fn unknown_model_returns_none_not_zero() {
        let dir = temp_dir("pricing-unknown");
        let cache = PricingCache::new(&dir);
        assert!(cache.rates_for("totally-made-up-model-9000").is_none());
    }

    #[test]
    fn rates_are_per_million_not_per_token() {
        let dir = temp_dir("pricing-units");
        let cache = PricingCache::new(&dir);
        let rates = cache.rates_for("claude-sonnet-4-5-20250929").unwrap();
        // LiteLLM stores per-token (e.g. 3e-6). We expose per-million (e.g. 3.0)
        // because that is what the existing plugin tables already assume.
        assert!(
            rates.input > 0.01 && rates.input < 1000.0,
            "expected per-million dollars, got {}",
            rates.input
        );
    }

    #[test]
    fn a_fetch_failure_is_not_an_error_state() {
        let dir = temp_dir("pricing-offline");
        let cache = PricingCache::with_endpoint(&dir, "http://127.0.0.1:1/nope.json");
        // Must degrade to cache -> embedded, log a warning, and not panic.
        assert!(cache.rates_for("claude-sonnet-4-5-20250929").is_some());
    }

    #[test]
    fn a_failed_refresh_leaves_the_embedded_prices_serving() {
        let dir = temp_dir("pricing-offline-refresh");
        let cache = PricingCache::with_endpoint(&dir, "http://127.0.0.1:1/nope.json");

        assert!(cache.is_due(), "a cold cache is due for a refresh");
        assert!(!refresh(&cache.inner), "the fetch cannot succeed");

        // Degraded, not broken: known models still price, nothing was cached,
        // and the failure backs off instead of retrying on the next lookup.
        assert!(cache.rates_for("claude-sonnet-4-5-20250929").is_some());
        assert!(cache.overlay().is_none());
        assert!(!dir.join("pricing").join("litellm-pricing.json").exists());
        assert!(!cache.is_due(), "a failed fetch must back off");
    }

    #[test]
    fn a_warm_disk_cache_prices_models_the_embedded_snapshot_has_never_heard_of() {
        let dir = temp_dir("pricing-warm");
        write_cache_file(&dir, &overlay_json());

        // Endpoint is unreachable on purpose: this must be served from disk.
        let cache = PricingCache::with_endpoint(&dir, "http://127.0.0.1:1/nope.json");

        let rates = cache
            .rates_for(OVERLAY_ONLY_MODEL)
            .expect("the disk cache must price a model the embedded snapshot lacks");
        // `× 1e6` is not exact in binary floating point (2e-7 lands on
        // 0.19999999999999998), so compare within a fraction of a cent per
        // million tokens rather than bit-for-bit.
        assert_near(rates.input, 2.0);
        assert_near(rates.output, 10.0);
        assert_near(rates.cache_write, 2.5);
        assert_near(rates.cache_read, 0.2);
        assert!(
            !cache.is_due(),
            "a cache written just now is inside its TTL"
        );
    }

    #[test]
    fn an_expired_disk_cache_refetches_and_the_new_prices_take_effect() {
        let dir = temp_dir("pricing-expired");
        // Yesterday's cache priced this model at $1/M. Today's fetch says $2/M.
        let stale = format!(
            r#"{{"{}": {{"input_cost_per_token": 0.000001, "output_cost_per_token": 0.000001}}}}"#,
            OVERLAY_ONLY_MODEL
        );
        let cache_file = write_cache_file(&dir, &stale);
        backdate(&cache_file, Duration::from_secs(25 * 60 * 60));

        let cache = PricingCache::with_endpoint(&dir, &serve_once(overlay_json()));
        assert_eq!(
            cache.rates_for(OVERLAY_ONLY_MODEL).unwrap().input,
            1.0,
            "the stale cache is served until the refresh lands"
        );
        assert!(cache.is_due(), "a cache older than the TTL is due");

        assert!(refresh(&cache.inner), "the refetch must succeed");

        assert_eq!(cache.rates_for(OVERLAY_ONLY_MODEL).unwrap().input, 2.0);
        assert!(!cache.is_due(), "a fresh fetch resets the TTL");
        assert!(
            fs::read_to_string(&cache_file)
                .unwrap()
                .contains("0.000002"),
            "the refetched prices must be written back to disk"
        );
    }

    #[test]
    fn the_overlay_handed_to_the_vendored_loader_is_the_cached_json() {
        let dir = temp_dir("pricing-overlay");
        write_cache_file(&dir, &overlay_json());
        let cache = PricingCache::with_endpoint(&dir, "http://127.0.0.1:1/nope.json");

        let overlay = cache.overlay().expect("a warm cache must yield an overlay");
        assert!(overlay.contains(OVERLAY_ONLY_MODEL));
    }
}
