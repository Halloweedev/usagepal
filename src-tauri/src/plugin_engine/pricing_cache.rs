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
//! Three rules the rest of the app depends on:
//!
//! - **An unknown model is `None`, never `Some(zero)`.** A `$0` that means "we
//!   don't know" must not look like a `$0` that means "free".
//! - **A fetch failure is not an error state.** It logs at `warn` and falls
//!   through cache → embedded. Users on a plane still get prices. This is the
//!   degradation the design spec sanctions, not a silent fallback hiding a
//!   problem: nothing is hidden, and no number is invented.
//! - **Reading a price is a pure in-memory read.** [`PricingCache::rates_for`]
//!   and [`PricingCache::overlay`] answer from the snapshot already in memory
//!   and never touch the network or the disk. Refreshing is the job of the
//!   ticker [`init`] starts, and *only* of that ticker.
//!
//! That last rule is what keeps an app left open for a week current: the ticker
//! runs on wall-clock time, whether or not anyone is querying, so a user with no
//! Claude or Codex plugin enabled still gets fresh prices. Tying the refresh to
//! the read instead would refresh only what happens to be read, and would put a
//! live GitHub fetch behind every unit test that looks up a rate.

use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock, PoisonError, RwLock};
use std::time::{Duration, SystemTime};

use ccusage_vendor::PricingTable;

/// Upstream's URL, unchanged (`vendor/ccusage/src/pricing.rs`).
const LITELLM_PRICING_URL: &str =
    "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const CACHE_TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How long to wait before trying again after a failed fetch. Without this, an
/// offline machine would re-attempt every time the ticker comes round.
const RETRY_AFTER_FAILURE: Duration = Duration::from_secs(30 * 60);
/// How often the refresh ticker wakes up to ask whether a fetch is due. Fine
/// enough to honor `RETRY_AFTER_FAILURE` promptly, coarse enough to be free.
const REFRESH_TICK: Duration = Duration::from_secs(15 * 60);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const FETCH_TIMEOUT: Duration = Duration::from_secs(20);
/// LiteLLM's file is ~2 MB. This is a boundary guard, not a tight bound — but it
/// is enforced against the bytes actually read, not against a `Content-Length`
/// header that a chunked response simply does not send.
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
    /// cache we have, `now` for one we don't (or one that turned out to be
    /// corrupt), `now + RETRY_AFTER_FAILURE` after a failure.
    next_attempt: RwLock<SystemTime>,
}

// Both locks guard a plain value swap — no user code runs while either is held,
// so neither can actually be poisoned. They are read through
// `PoisonError::into_inner` anyway, because the alternative failure mode is
// silent and permanent: an `.expect()` here would kill the refresh ticker on the
// tick after a poisoning, and the app would then serve a frozen price table for
// the rest of the process's life with nothing logged.
impl Inner {
    fn snapshot(&self) -> Arc<Snapshot> {
        Arc::clone(&self.snapshot.read().unwrap_or_else(PoisonError::into_inner))
    }

    fn install(&self, snapshot: Snapshot) {
        *self
            .snapshot
            .write()
            .unwrap_or_else(PoisonError::into_inner) = Arc::new(snapshot);
    }

    fn set_next_attempt(&self, at: SystemTime) {
        *self
            .next_attempt
            .write()
            .unwrap_or_else(PoisonError::into_inner) = at;
    }

    fn is_due(&self) -> bool {
        let next_attempt = *self
            .next_attempt
            .read()
            .unwrap_or_else(PoisonError::into_inner);
        SystemTime::now() >= next_attempt
    }
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
        let now = SystemTime::now();
        let next_attempt = match cached.as_ref() {
            // Clamped, because the file's mtime is not a clock we control: a
            // restored backup, a sync tool, or a machine whose clock ran fast
            // can date it in the future, and an unclamped `mtime + TTL` would
            // then suppress every refresh until wall-clock caught up.
            Some((_, fetched_at)) => (*fetched_at + CACHE_TTL).min(now + CACHE_TTL),
            None => now,
        };
        let overlay = cached.map(|(json, _)| Arc::from(json));

        Self {
            inner: Arc::new(Inner {
                cache_file,
                endpoint: endpoint.to_string(),
                snapshot: RwLock::new(Arc::new(Snapshot::new(overlay))),
                next_attempt: RwLock::new(next_attempt),
            }),
        }
    }

    /// Rates for `model`, or `None` if no price is known for it.
    ///
    /// A **pure in-memory read**: it answers from the snapshot the ticker last
    /// installed and performs no network or disk I/O. See the module header.
    pub fn rates_for(&self, model: &str) -> Option<ModelRates> {
        self.inner
            .snapshot()
            .table
            .lookup(model)
            .map(|rates| ModelRates {
                input: rates.input * PER_MILLION,
                output: rates.output * PER_MILLION,
                cache_write: rates.cache_write * PER_MILLION,
                cache_read: rates.cache_read * PER_MILLION,
            })
    }

    /// The LiteLLM JSON to overlay onto the vendored loader's embedded pricing,
    /// or `None` when we have never successfully fetched (the loader then uses
    /// the embedded snapshot alone, exactly as before). A pure in-memory read,
    /// like [`Self::rates_for`].
    pub fn overlay(&self) -> Option<Arc<str>> {
        self.inner.snapshot().overlay.clone()
    }

    /// Refreshes the table on its own thread for the life of the process:
    /// immediately if the cache is cold, stale or corrupt, and thereafter
    /// whenever it falls due.
    ///
    /// This is the **only** thing in the module that fetches. Reads do not, so a
    /// price a caller never asks for still gets refreshed (a user with no
    /// Claude or Codex plugin enabled would otherwise go stale after 24h for as
    /// long as the app stayed open — weeks, for a menubar app), and no test can
    /// accidentally reach the network by looking up a rate.
    fn spawn_refresh_ticker(&self) {
        let inner = Arc::clone(&self.inner);
        let spawned = std::thread::Builder::new()
            .name("pricing-refresh".to_string())
            .spawn(move || loop {
                if inner.is_due() {
                    refresh(&inner);
                }
                std::thread::sleep(REFRESH_TICK);
            });
        if let Err(err) = spawned {
            log::warn!(
                "could not start the pricing refresh ticker ({}); serving cached/embedded prices",
                err
            );
        }
    }

    /// Only the ticker asks this in production (through `Inner`); the tests ask
    /// it to pin *when* the next fetch is allowed, which is where the corrupt-
    /// cache and clock-skew bugs live.
    #[cfg(test)]
    fn is_due(&self) -> bool {
        self.inner.is_due()
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
            inner.set_next_attempt(SystemTime::now() + RETRY_AFTER_FAILURE);
            return false;
        }
    };

    write_cache(&inner.cache_file, &json);
    inner.install(Snapshot::new(Some(Arc::from(json))));
    inner.set_next_attempt(SystemTime::now() + CACHE_TTL);
    log::info!("refreshed model pricing from LiteLLM");
    true
}

/// The response body, validated as a LiteLLM pricing document.
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
    // `Content-Length` is a hint, not a bound: a chunked response carries none at
    // all, and a hostile one can lie. So the cap is enforced on the bytes we
    // actually read — `Response::text()` would buffer whatever arrives.
    let mut body = Vec::new();
    response
        .take(MAX_RESPONSE_BYTES + 1)
        .read_to_end(&mut body)
        .map_err(|err| err.to_string())?;
    if body.len() as u64 > MAX_RESPONSE_BYTES {
        return Err(format!("response exceeded {} bytes", MAX_RESPONSE_BYTES));
    }
    let body = String::from_utf8(body).map_err(|_| "response was not UTF-8".to_string())?;
    parse_pricing_json(&body)?;
    Ok(body)
}

/// Checks that `json` is what LiteLLM serves: a non-empty JSON object keyed by
/// model name.
///
/// Deserializing the keys and discarding the values (`IgnoredAny`) validates the
/// whole document — a truncated file fails at EOF, a tampered one fails at the
/// bad token — without building and throwing away a ~2 MB `serde_json::Value`
/// tree. The values are checked where they are actually used, by the vendored
/// `PricingMap::load_json`.
fn parse_pricing_json(json: &str) -> Result<(), String> {
    let models: HashMap<String, serde::de::IgnoredAny> = serde_json::from_str(json)
        .map_err(|err| format!("not a JSON object of models: {}", err))?;
    if models.is_empty() {
        return Err("no models in the pricing JSON".to_string());
    }
    Ok(())
}

/// The cached JSON and when it was written. The file's mtime *is* the fetch
/// time — there is no sidecar and no wrapper envelope, so the file on disk is
/// byte-for-byte what LiteLLM served.
///
/// The file is a boundary, not a value we can trust: `write_cache`'s
/// temp-file-plus-rename does not `fsync`, so a power loss can land the rename
/// without the bytes; a backup or sync tool can put anything there. A corrupt
/// file that got *accepted* would be doubly bad — the vendored loader would
/// silently drop it and price from the embedded snapshot alone, while its mtime
/// held the next fetch a full day away, so nothing would ever repair it. Treat
/// it as absent instead: warn, and let the caller refetch now.
fn read_cache(cache_file: &Path) -> Option<(String, SystemTime)> {
    let fetched_at = fs::metadata(cache_file).ok()?.modified().ok()?;
    let json = fs::read_to_string(cache_file).ok()?;
    if let Err(err) = parse_pricing_json(&json) {
        log::warn!("discarding corrupt pricing cache ({}); refetching", err);
        return None;
    }
    Some((json, fetched_at))
}

/// Writes via a temp file + rename, so a crash or a full disk cannot leave a
/// half-written file where the cache belongs. (It is not a `fsync`, so it is not
/// a guarantee against power loss — which is why `read_cache` validates.)
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

/// Called once at startup with the app data dir. Installs the process-wide cache
/// and starts the refresh ticker — the only entry point that fetches.
pub fn init(app_data_dir: &Path) {
    if GLOBAL.set(PricingCache::new(app_data_dir)).is_err() {
        return; // already initialized; its ticker is already running
    }
    if let Some(cache) = global() {
        cache.spawn_refresh_ticker();
    }
}

/// `None` before [`init`] (tests, and any code path that runs without an app
/// data dir) — callers then get embedded pricing, which is the pre-Task-4
/// behavior.
pub fn global() -> Option<&'static PricingCache> {
    GLOBAL.get()
}

/// Test-only seeder for [`GLOBAL`]: installs a cache **without** starting the
/// refresh ticker, so nothing calling this can ever reach [`fetch`]. Unlike
/// [`init`], which is the app's one entry point that fetches, this is the
/// app's one entry point that deliberately never does — callers pass an
/// unreachable `endpoint` and a [`test_fixtures::temp_dir`] guard so a lookup
/// through `GLOBAL` is served purely from the embedded snapshot, the same
/// guarantee direct `PricingCache` instances get from [`PricingCache::rates_for`]
/// never touching the network.
///
/// `GLOBAL` is a process-wide `OnceLock` shared by the whole `--lib` test
/// binary, so only the first caller across all tests actually installs
/// anything; later calls are silent no-ops, matching [`init`]'s own
/// already-initialized behavior.
#[doc(hidden)]
pub fn init_for_tests(dir: &Path, endpoint: &str) {
    let _ = GLOBAL.set(PricingCache::with_endpoint(dir, endpoint));
}

/// Free-function wrapper around [`PricingCache::rates_for`] for callers (like
/// `host_api::inject_pricing`) that only have the process-wide cache, not an
/// instance. `None` both when the model is unknown and when [`init`] has not
/// run yet — `init` runs synchronously during Tauri setup, before any plugin
/// probe, so the latter is not reachable in practice.
pub fn rates_for(model: &str) -> Option<ModelRates> {
    global()?.rates_for(model)
}

/// Fixtures shared by this module's unit tests and `tests/pricing_overlay.rs`.
///
/// Not `#[cfg(test)]`, and that is not an oversight: an integration test is a
/// separate crate that links this library as a dependency, so it cannot see
/// this crate's `#[cfg(test)]` items. The choice is a `#[doc(hidden)]` module of
/// two consts and a temp-dir guard, or two copies of the same overlay JSON free
/// to drift apart. Nothing in the app calls any of it.
#[doc(hidden)]
pub mod test_fixtures {
    use std::fs;
    use std::ops::Deref;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    /// Chosen so that neither direction of ccusage v20.0.2's bidirectional
    /// substring matcher (`model.contains(key) || key.contains(model)`) can pair
    /// it with any embedded key — if it prices at all, it priced from the
    /// overlay.
    pub const OVERLAY_ONLY_MODEL: &str = "zzz-future-model-20260101";

    /// LiteLLM-shaped pricing for [`OVERLAY_ONLY_MODEL`]: $2/M in, $10/M out,
    /// $2.50/M cache write, $0.20/M cache read.
    pub const OVERLAY_JSON: &str = r#"{
  "zzz-future-model-20260101": {
    "input_cost_per_token": 0.000002,
    "output_cost_per_token": 0.00001,
    "cache_creation_input_token_cost": 0.0000025,
    "cache_read_input_token_cost": 0.0000002
  }
}"#;

    /// A unique temp directory that deletes itself when the test drops it —
    /// without one, every `cargo test` run left its directories behind in
    /// `$TMPDIR`. Derefs to `Path`, so a `&TempDir` is a `&Path` at any call
    /// site that wants one.
    pub struct TempDir(PathBuf);

    impl Deref for TempDir {
        type Target = Path;

        fn deref(&self) -> &Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    pub fn temp_dir(name: &str) -> TempDir {
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
        TempDir(path)
    }
}

#[cfg(test)]
mod tests {
    use super::test_fixtures::{temp_dir, TempDir, OVERLAY_JSON, OVERLAY_ONLY_MODEL};
    use super::*;
    use std::fs;
    use std::io::Write;
    use std::net::TcpListener;

    fn assert_near(actual: f64, expected: f64) {
        assert!(
            (actual - expected).abs() < 1e-9,
            "expected {}, got {}",
            expected,
            actual
        );
    }

    /// The rate currently being served, read straight off the snapshot, so a
    /// test can pin what is on offer *before* it drives a refresh by hand.
    fn served_input_rate(cache: &PricingCache, model: &str) -> Option<f64> {
        cache
            .inner
            .snapshot()
            .table
            .lookup(model)
            .map(|rates| rates.input * PER_MILLION)
    }

    fn cache_path(dir: &Path) -> PathBuf {
        dir.join("pricing").join("litellm-pricing.json")
    }

    fn write_cache_file(dir: &Path, json: &str) -> PathBuf {
        let cache_file = cache_path(dir);
        fs::create_dir_all(cache_file.parent().expect("cache parent")).expect("create cache dir");
        fs::write(&cache_file, json).expect("write cache file");
        cache_file
    }

    fn set_mtime(cache_file: &Path, when: SystemTime) {
        let file = fs::File::options()
            .write(true)
            .open(cache_file)
            .expect("open cache file");
        file.set_times(fs::FileTimes::new().set_modified(when))
            .expect("set cache file mtime");
    }

    fn backdate(cache_file: &Path, age: Duration) {
        set_mtime(cache_file, SystemTime::now() - age);
    }

    fn next_attempt(cache: &PricingCache) -> SystemTime {
        *cache
            .inner
            .next_attempt
            .read()
            .unwrap_or_else(PoisonError::into_inner)
    }

    /// A one-shot HTTP/1.1 responder on localhost. Keeps the tests that *do*
    /// exercise a fetch hermetic — no GitHub, no network beyond the loopback.
    fn serve_once(body: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let url = format!("http://{}/pricing.json", listener.local_addr().unwrap());
        let body = body.to_string();
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
    fn models_dev_prices_a_model_litellm_lacks() {
        let dir = temp_dir("pricing-models-dev");
        let cache = PricingCache::new(&dir);
        // claude-fable-5 is absent from LiteLLM but present in the embedded
        // models.dev snapshot. Resolved entirely offline — no network.
        let rates = cache
            .rates_for("claude-fable-5")
            .expect("embedded models.dev snapshot must price a model LiteLLM lacks");
        assert_near(rates.input, 10.0);
        assert_near(rates.output, 50.0);
        assert_near(rates.cache_write, 12.5);
        assert_near(rates.cache_read, 1.0);
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

    /// The read path is pure, and the three tests above depend on it being so:
    /// each calls `PricingCache::new`, which points at the **production**
    /// LiteLLM URL, on a cold cache dir. If reading a rate could fetch, they
    /// would race a live GitHub request under their own assertions — the cold
    /// test would stop proving the embedded fallback it is named for, and the
    /// unknown-model test would start depending on what LiteLLM published
    /// today. Reads do not fetch. This pins that.
    #[test]
    fn reading_a_rate_never_fetches() {
        let dir = temp_dir("pricing-pure-read");
        let cache = PricingCache::new(&dir);
        assert!(cache.is_due(), "a cold cache is due for a refresh");

        assert!(cache.rates_for("claude-sonnet-4-5-20250929").is_some());
        assert!(cache.rates_for(OVERLAY_ONLY_MODEL).is_none());
        assert!(cache.overlay().is_none());

        assert!(
            cache.is_due(),
            "a read must not fetch, and must not schedule or record one"
        );
        assert!(
            !dir.join("pricing").exists(),
            "a read must not write a cache file"
        );
    }

    #[test]
    fn a_failed_refresh_leaves_the_embedded_prices_serving() {
        let dir = temp_dir("pricing-offline-refresh");
        let cache = PricingCache::with_endpoint(&dir, "http://127.0.0.1:1/nope.json");

        assert!(cache.is_due(), "a cold cache is due for a refresh");
        assert!(!refresh(&cache.inner), "the fetch cannot succeed");

        // Degraded, not broken: known models still price, nothing was cached,
        // and the failure backs off instead of retrying on the next tick.
        assert!(cache.rates_for("claude-sonnet-4-5-20250929").is_some());
        assert!(cache.overlay().is_none());
        assert!(!cache_path(&dir).exists());
        assert!(!cache.is_due(), "a failed fetch must back off");
    }

    #[test]
    fn a_warm_disk_cache_prices_models_the_embedded_snapshot_has_never_heard_of() {
        let dir = temp_dir("pricing-warm");
        write_cache_file(&dir, OVERLAY_JSON);

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

        let cache = PricingCache::with_endpoint(&dir, &serve_once(OVERLAY_JSON));

        assert_near(
            served_input_rate(&cache, OVERLAY_ONLY_MODEL).expect("the stale cache prices it"),
            1.0,
        );
        assert!(cache.is_due(), "a cache older than the TTL is due");

        // Driven by hand: the ticker only exists once `init` runs, and no test
        // runs `init`.
        assert!(refresh(&cache.inner), "the refetch must succeed");

        assert_near(cache.rates_for(OVERLAY_ONLY_MODEL).unwrap().input, 2.0);
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
        write_cache_file(&dir, OVERLAY_JSON);
        let cache = PricingCache::with_endpoint(&dir, "http://127.0.0.1:1/nope.json");

        let overlay = cache.overlay().expect("a warm cache must yield an overlay");
        assert!(overlay.contains(OVERLAY_ONLY_MODEL));
    }

    /// A cache file that is fresh by its mtime but corrupt in its bytes — a
    /// power loss between the `rename` and the data reaching the platter, a sync
    /// tool half-writing it, a bad sector. Trusting it costs a **day**: the
    /// vendored loader silently drops an unparseable overlay and prices from the
    /// embedded snapshot alone, while `mtime + TTL` holds the next fetch 24h
    /// out, so nothing ever repairs the file and nothing is logged. It must
    /// count as absent and refetch now.
    #[test]
    fn a_corrupt_disk_cache_is_discarded_and_refetched_immediately() {
        let dir = temp_dir("pricing-corrupt");
        let truncated = &OVERLAY_JSON[..OVERLAY_JSON.len() / 2];
        let cache_file = write_cache_file(&dir, truncated);

        let cache = PricingCache::with_endpoint(&dir, &serve_once(OVERLAY_JSON));

        assert!(
            cache.overlay().is_none(),
            "a corrupt cache must not be handed to the loader as an overlay"
        );
        assert!(
            cache.rates_for("claude-sonnet-4-5-20250929").is_some(),
            "the embedded snapshot still prices"
        );
        assert!(
            cache.is_due(),
            "a corrupt cache must refetch now, not in 24 hours"
        );

        // And the refetch repairs the file rather than leaving it broken.
        assert!(refresh(&cache.inner), "the refetch must succeed");
        assert_near(cache.rates_for(OVERLAY_ONLY_MODEL).unwrap().input, 2.0);
        assert_eq!(
            fs::read_to_string(&cache_file).unwrap(),
            OVERLAY_JSON,
            "the corrupt file must be overwritten by the fetched JSON"
        );
    }

    /// A file that parses but carries no models (`{}`, a stray `null`, an array,
    /// a bare number) is corrupt for our purposes too: it would load zero prices
    /// and still hold the TTL for a day.
    #[test]
    fn an_empty_or_non_object_disk_cache_counts_as_corrupt() {
        for body in ["{}", "null", "[]", "123"] {
            let dir = temp_dir("pricing-empty");
            write_cache_file(&dir, body);
            let cache = PricingCache::with_endpoint(&dir, "http://127.0.0.1:1/nope.json");
            assert!(cache.overlay().is_none(), "`{}` is not a pricing map", body);
            assert!(cache.is_due(), "`{}` must refetch now", body);
        }
    }

    /// A cache file dated in the future — a restored backup, a sync tool, a
    /// clock that ran fast — must not suppress refreshes until wall-clock time
    /// catches up. `mtime + TTL` is clamped to `now + TTL`.
    #[test]
    fn a_future_dated_cache_still_expires_within_the_ttl() {
        let dir = temp_dir("pricing-future");
        let cache_file = write_cache_file(&dir, OVERLAY_JSON);
        let a_year = Duration::from_secs(365 * 24 * 60 * 60);
        set_mtime(&cache_file, SystemTime::now() + a_year);

        let cache = PricingCache::with_endpoint(&dir, "http://127.0.0.1:1/nope.json");

        assert!(
            next_attempt(&cache) <= SystemTime::now() + CACHE_TTL,
            "a future mtime must not push the next fetch past one TTL from now"
        );
    }

    /// The guard exists so `cargo test` stops leaving directories in `$TMPDIR`.
    #[test]
    fn the_temp_dir_guard_cleans_up_after_itself() {
        let path: PathBuf = {
            let dir: TempDir = temp_dir("pricing-cleanup");
            assert!(dir.exists());
            dir.to_path_buf()
        };
        assert!(!path.exists(), "the temp dir must be removed on drop");
    }
}
