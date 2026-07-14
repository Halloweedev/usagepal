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

/// The home override must never be visible in the process environment — not
/// even transiently, while a load is in flight.
///
/// It used to be: the wrappers called `std::env::set_var("CODEX_HOME", ...)`
/// under a mutex, held it for the duration of the load, and restored it after.
/// That mutex excluded other ccusage queries and nothing else. It could not
/// exclude `host_api::read_env_from_process` (which backs a JS API whose
/// whitelist literally includes `CODEX_HOME` and `CLAUDE_CONFIG_DIR`), nor the
/// Cocoa/WebKit threads in a Tauri process that call `getenv` with no
/// synchronization a Rust lock can participate in — which is why `set_var` is
/// `unsafe` in edition 2024. The override is a thread-local now, and nothing
/// writes the environment.
///
/// Note a before/after comparison would NOT catch the old code (it restored the
/// value on drop), so this samples the environment from a *concurrent reader*
/// while loads run — the reader standing in for the JS env API. A regression to
/// `set_var` leaves `CODEX_HOME` set for the whole of each load, so the sampler
/// sees it essentially immediately. The test can only ever fail on a real
/// regression, never on a scheduling fluke.
#[test]
fn query_daily_never_exposes_the_home_override_in_the_process_environment() {
    force_utc();
    let home = fixtures().join("codex");
    let done = std::sync::atomic::AtomicBool::new(false);
    let leaked = std::sync::Mutex::new(None::<std::ffi::OsString>);
    let baseline = std::env::var_os("CODEX_HOME");

    std::thread::scope(|scope| {
        scope.spawn(|| {
            while !done.load(std::sync::atomic::Ordering::Relaxed) {
                let observed = std::env::var_os("CODEX_HOME");
                if observed != baseline {
                    *leaked.lock().unwrap() = observed;
                    return;
                }
                std::hint::spin_loop();
            }
        });

        for _ in 0..20 {
            usagepal_lib::plugin_engine::ccusage::query_daily(
                usagepal_lib::plugin_engine::ccusage::Provider::Codex,
                Some(&home),
                None,
                None,
            )
            .expect("vendored loader ran");
        }
        done.store(true, std::sync::atomic::Ordering::Relaxed);
    });

    assert_eq!(
        leaked.into_inner().unwrap(),
        None,
        "a concurrent reader saw the home override in the process environment — \
         the loader is mutating the environment again (see VENDORING.md, \
         'Home override channel')"
    );
    assert_eq!(
        std::env::var_os("CODEX_HOME"),
        baseline,
        "query_daily must leave CODEX_HOME exactly as it found it"
    );
}

/// Concurrent loads on different threads must not see each other's home.
///
/// With a process-wide env var they shared one; correctness depended entirely
/// on a mutex serializing every query. The override is per-thread now, so this
/// runs the fixture home against a nonexistent home in parallel and requires
/// the fixture threads to keep producing the fixture's numbers.
#[test]
fn concurrent_queries_do_not_share_a_home_override() {
    force_utc();
    let real = fixtures().join("codex");
    let missing = fixtures().join("codex-does-not-exist");
    let expected: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(fixtures().join("codex-expected.json"))
            .expect("checked-in reference output from ccusage@20.0.2"),
    )
    .expect("reference output is valid JSON");

    std::thread::scope(|scope| {
        let handles: Vec<_> = (0..8)
            .map(|i| {
                let (home, expected) = (&real, &expected);
                let missing = &missing;
                scope.spawn(move || {
                    let home = if i % 2 == 0 { home } else { missing };
                    let actual = usagepal_lib::plugin_engine::ccusage::query_daily(
                        usagepal_lib::plugin_engine::ccusage::Provider::Codex,
                        Some(home),
                        None,
                        None,
                    )
                    .expect("vendored loader ran");
                    if i % 2 == 0 {
                        assert_eq!(
                            &actual, expected,
                            "a concurrent query against another home leaked into this one"
                        );
                    } else {
                        assert_eq!(
                            actual["daily"],
                            serde_json::json!([]),
                            "a nonexistent home must yield no days, not another thread's data"
                        );
                    }
                })
            })
            .collect();
        for handle in handles {
            handle.join().expect("no thread panicked");
        }
    });
}
