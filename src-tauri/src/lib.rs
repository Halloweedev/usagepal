mod beta_updater;
mod clinepass_key;
mod config;
mod local_http_api;
mod log_path;
mod notifications;
mod onboarding;
mod openrouter_key;
mod panel;
mod keylight;
mod plugin_engine;
mod tray;
mod whats_new;

use std::collections::{HashMap, HashSet, VecDeque};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

/// Unix-ms timestamp of the next scheduled auto-update, published by the native
/// scheduler so the UI countdown reflects the real schedule instead of resetting
/// to a full interval every time the panel opens. 0 = not yet scheduled.
static NEXT_UPDATE_AT_MS: AtomicU64 = AtomicU64::new(0);

fn unix_now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis() as u64)
        .unwrap_or(0)
}

use serde::Serialize;
use specta::Type;
use tauri::{Emitter, Manager};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_store::StoreExt;
use uuid::Uuid;

#[cfg(desktop)]
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const GLOBAL_SHORTCUT_STORE_KEY: &str = "globalShortcut";
const LOG_LEVEL_STORE_KEY: &str = "logLevel";
const MAX_CONCURRENT_PROBES: usize = 4;

fn probe_worker_count(plugin_count: usize) -> usize {
    plugin_count.min(MAX_CONCURRENT_PROBES)
}

#[cfg(desktop)]
fn managed_shortcut_slot() -> &'static Mutex<Option<String>> {
    static SLOT: OnceLock<Mutex<Option<String>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// Shared shortcut handler that toggles the panel when the shortcut is pressed.
#[cfg(desktop)]
fn handle_global_shortcut(
    app: &tauri::AppHandle,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if event.state == ShortcutState::Pressed {
        log::debug!("Global shortcut triggered");
        panel::toggle_panel(app);
    }
}

pub struct AppState {
    /// Plugins are wrapped in Arc because they're loaded once at startup and
    /// cloned into every probe batch. Arc avoids deep-cloning the full
    /// LoadedPlugin (entry script, icon data URL, etc.) on each probe cycle.
    pub plugins: Vec<Arc<plugin_engine::manifest::LoadedPlugin>>,
    pub app_data_dir: PathBuf,
    pub app_version: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginMeta {
    pub id: String,
    pub name: String,
    pub icon_url: String,
    pub brand_color: Option<String>,
    pub lines: Vec<ManifestLineDto>,
    pub links: Vec<PluginLinkDto>,
    /// Ordered list of primary metric candidates (sorted by primaryOrder).
    /// Frontend picks the first one that exists in runtime data.
    pub primary_candidates: Vec<String>,
    /// Label of the progress line marked `"period": "weekly"`, if any.
    /// Drives the menubar weekly-metric preference.
    pub weekly_candidate: Option<String>,
    /// Optional pair of progress-line labels for Multi menubar style.
    pub multi_tray_lines: Vec<String>,
    /// Optional progress-line label for single-provider menubar styles.
    pub tray_primary_label: Option<String>,
    /// Whether the provider's credentials/config were found on this machine.
    /// New users get detected plugins enabled by default; undetected ones start
    /// disabled so they don't show error cards for providers they don't use.
    pub detected: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ManifestLineDto {
    #[serde(rename = "type")]
    pub line_type: String,
    pub label: String,
    pub scope: String,
    pub escalate_at_percent: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PluginLinkDto {
    pub label: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ProbeBatchStarted {
    pub batch_id: String,
    pub plugin_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Type, tauri_specta::Event)]
#[tauri_specta(event_name = "probe:result")]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
    pub batch_id: String,
    pub output: plugin_engine::runtime::PluginOutput,
}

#[derive(Debug, Clone, Serialize, Type, tauri_specta::Event)]
#[tauri_specta(event_name = "probe:batch-complete")]
#[serde(rename_all = "camelCase")]
pub struct ProbeBatchComplete {
    pub batch_id: String,
}

#[tauri::command]
#[specta::specta]
fn init_panel(app_handle: tauri::AppHandle) {
    panel::init(&app_handle).expect("Failed to initialize panel");
}

#[tauri::command]
#[specta::specta]
fn hide_panel(app_handle: tauri::AppHandle) {
    use tauri_nspanel::ManagerExt;
    if let Ok(panel) = app_handle.get_webview_panel("main") {
        panel.hide();
    }
}

#[derive(serde::Deserialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct TrayRectInput {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[tauri::command]
#[specta::specta]
fn toggle_panel_at_tray_rect(
    app_handle: tauri::AppHandle,
    rect: TrayRectInput,
) {
    panel::toggle_panel_at_tray_rect(
        &app_handle,
        tauri::Position::Logical(tauri::LogicalPosition::new(rect.x, rect.y)),
        tauri::Size::Logical(tauri::LogicalSize::new(rect.width, rect.height)),
    );
}

#[tauri::command]
#[specta::specta]
fn open_devtools(#[allow(unused)] app_handle: tauri::AppHandle) {
    #[cfg(debug_assertions)]
    {
        use tauri::Manager;
        if let Some(window) = app_handle.get_webview_window("main") {
            window.open_devtools();
        }
    }
}

fn parse_log_level(level: &str) -> Option<log::LevelFilter> {
    match level {
        "error" => Some(log::LevelFilter::Error),
        "warn" => Some(log::LevelFilter::Warn),
        "info" => Some(log::LevelFilter::Info),
        "debug" => Some(log::LevelFilter::Debug),
        "trace" => Some(log::LevelFilter::Trace),
        _ => None,
    }
}

#[tauri::command]
#[specta::specta]
fn set_log_level(app_handle: tauri::AppHandle, level: String) -> Result<(), String> {
    let selected_level = parse_log_level(&level).ok_or_else(|| format!("invalid log level: {level}"))?;
    log::set_max_level(selected_level);

    let store = app_handle
        .store("settings.json")
        .map_err(|e| format!("failed to open settings store: {e}"))?;
    store.set(LOG_LEVEL_STORE_KEY, serde_json::json!(level));
    store
        .save()
        .map_err(|e| format!("failed to save log level: {e}"))?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn copy_log_path(app_handle: tauri::AppHandle) -> Result<(), String> {
    let path = log_path::for_app(&app_handle).map_err(|e| e.to_string())?;
    app_handle
        .clipboard()
        .write_text(path.to_string_lossy().to_string())
        .map_err(|e| format!("failed to copy log path: {e}"))
}

#[tauri::command]
#[specta::specta]
fn quit_app(app_handle: tauri::AppHandle) {
    app_handle.exit(0);
}

#[tauri::command]
#[specta::specta]
async fn start_probe_batch(
    app_handle: tauri::AppHandle,
    state: tauri::State<'_, Mutex<AppState>>,
    batch_id: Option<String>,
    plugin_ids: Option<Vec<String>>,
) -> Result<ProbeBatchStarted, String> {
    let batch_id = batch_id
        .and_then(|id| {
            let trimmed = id.trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed)
            }
        })
        .unwrap_or_else(|| Uuid::new_v4().to_string());

    let (plugins, app_data_dir, app_version) = {
        let locked = state.lock().map_err(|e| e.to_string())?;
        (
            locked.plugins.clone(),
            locked.app_data_dir.clone(),
            locked.app_version.clone(),
        )
    };

    let selected_plugins = match plugin_ids {
        Some(ids) => {
            let mut by_id: HashMap<String, Arc<plugin_engine::manifest::LoadedPlugin>> = plugins
                .into_iter()
                .map(|plugin| (plugin.manifest.id.clone(), plugin))
                .collect();
            let mut seen = HashSet::new();
            ids.into_iter()
                .filter_map(|id| {
                    if !seen.insert(id.clone()) {
                        return None;
                    }
                    by_id.remove(&id)
                })
                .collect()
        }
        None => plugins,
    };

    // Early return for empty batches — avoids allocating response_plugin_ids.
    if selected_plugins.is_empty() {
        let _ = app_handle.emit(
            "probe:batch-complete",
            ProbeBatchComplete {
                batch_id: batch_id.clone(),
            },
        );
        return Ok(ProbeBatchStarted {
            batch_id,
            plugin_ids: Vec::new(),
        });
    }

    let response_plugin_ids: Vec<String> = selected_plugins
        .iter()
        .map(|plugin| plugin.manifest.id.clone())
        .collect();

    log::info!(
        "probe batch {} starting: {:?}",
        batch_id,
        response_plugin_ids
    );

    run_probe_batch(
        app_handle,
        selected_plugins,
        app_data_dir,
        app_version,
        batch_id.clone(),
        false,
    );

    Ok(ProbeBatchStarted {
        batch_id,
        plugin_ids: response_plugin_ids,
    })
}

/// Run a probe batch across a bounded worker pool, emitting `probe:result` per
/// plugin and `probe:batch-complete` when the batch finishes. Shared by the
/// `start_probe_batch` command (frontend-initiated) and the native auto-update
/// scheduler. Returns immediately; the workers run on the async runtime.
///
/// When `emit_usage_updated` is true (scheduler-initiated batches), a single
/// `usage:updated` event is emitted on completion so an open panel can refresh
/// from the cache. Frontend-initiated batches already stream their results via
/// `probe:result` (matched by batch id), so they pass false.
fn run_probe_batch(
    app_handle: tauri::AppHandle,
    selected_plugins: Vec<Arc<plugin_engine::manifest::LoadedPlugin>>,
    app_data_dir: PathBuf,
    app_version: String,
    batch_id: String,
    emit_usage_updated: bool,
) {
    let selected_count = selected_plugins.len();
    let worker_count = probe_worker_count(selected_count);
    if worker_count < selected_count {
        log::info!(
            "probe batch {} using {} workers for {} plugins",
            batch_id,
            worker_count,
            selected_count
        );
    }

    let remaining = Arc::new(AtomicUsize::new(selected_count));
    let probe_queue = Arc::new(Mutex::new(
        selected_plugins.into_iter().collect::<VecDeque<_>>(),
    ));

    for _ in 0..worker_count {
        let handle = app_handle.clone();
        let completion_handle = app_handle.clone();
        let bid = batch_id.clone();
        let completion_bid = batch_id.clone();
        let data_dir = app_data_dir.clone();
        let version = app_version.clone();
        let counter = Arc::clone(&remaining);
        let queue = Arc::clone(&probe_queue);

        tauri::async_runtime::spawn_blocking(move || {
            loop {
                let plugin = {
                    let mut queue = queue
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    queue.pop_front()
                };

                let Some(plugin) = plugin else {
                    break;
                };

                let plugin_id = plugin.manifest.id.clone();
                let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    plugin_engine::runtime::run_probe(&plugin, &data_dir, &version)
                }));

                match result {
                    Ok(output) => {
                        let has_error = output.lines.iter().any(|line| {
                            matches!(line, plugin_engine::runtime::MetricLine::Badge { label, .. } if label == "Error")
                        });
                        let is_rate_limited =
                            plugin_engine::runtime::is_rate_limited_output(&output);
                        if has_error {
                            log::warn!("probe {} completed with error", plugin_id);
                        } else if is_rate_limited {
                            log::warn!(
                                "probe {} completed rate-limited ({} lines); keeping prior cache",
                                plugin_id,
                                output.lines.len()
                            );
                        } else {
                            log::info!(
                                "probe {} completed ok ({} lines)",
                                plugin_id,
                                output.lines.len()
                            );
                            local_http_api::cache_successful_output(&output);
                        }
                        let _ = handle.emit(
                            "probe:result",
                            ProbeResult {
                                batch_id: bid.clone(),
                                output,
                            },
                        );
                    }
                    Err(_) => {
                        log::error!("probe {} panicked", plugin_id);
                    }
                }

                if counter.fetch_sub(1, Ordering::SeqCst) == 1 {
                    log::info!("probe batch {} complete", completion_bid);
                    let _ = completion_handle.emit(
                        "probe:batch-complete",
                        ProbeBatchComplete {
                            batch_id: completion_bid.clone(),
                        },
                    );
                    if emit_usage_updated {
                        let _ = completion_handle.emit("usage:updated", ());
                    }
                }
            }
        });
    }
}

/// Longest the scheduler sleeps in a single slice while waiting for the next
/// update. Bounding each sleep lets the loop notice a wake-from-sleep — where
/// the wall clock jumps past the deadline — within one slice, instead of
/// oversleeping by the whole suspend duration. Each extra wake is a single
/// integer compare, so the battery/CPU cost is negligible; the machine performs
/// no wakes at all while actually asleep.
const SCHEDULER_MAX_SLICE_MS: u64 = 30_000;

/// What the scheduler loop should do on this tick, given the current wall-clock
/// time and the deadline for the next update. Kept pure so the wake-aware timing
/// logic is unit-testable without spawning threads or sleeping.
#[derive(Debug, PartialEq, Eq)]
enum SchedulerAction {
    /// Deadline reached (or passed, e.g. after waking from sleep) — probe now.
    Fire,
    /// Sleep this many milliseconds, then re-evaluate.
    Sleep(u64),
}

/// Decide the next scheduler action. Fires once `now_ms` reaches `deadline_ms`;
/// otherwise sleeps toward the deadline in slices capped at `max_slice_ms`.
fn scheduler_step(now_ms: u64, deadline_ms: u64, max_slice_ms: u64) -> SchedulerAction {
    if now_ms >= deadline_ms {
        SchedulerAction::Fire
    } else {
        SchedulerAction::Sleep((deadline_ms - now_ms).min(max_slice_ms))
    }
}

/// Extra wall-clock time, beyond the slice we asked to sleep, that marks the
/// machine as having been suspended (lid closed) rather than merely descheduled.
/// A real suspend jumps the wall clock by minutes-to-hours; normal scheduler
/// jitter stays far below this, so the slack keeps us from firing spuriously.
const SUSPEND_DETECT_SLACK_MS: u64 = 5_000;

/// True when a slice that asked to sleep `slept_ms` actually saw `elapsed_ms` of
/// wall clock pass — i.e. the machine was suspended mid-slice and just woke. On
/// wake we refresh right away (within one slice) even if the interval deadline
/// hasn't arrived, so coming back to the app shows fresh data without reopening
/// it and without waiting out the rest of the interval. Kept pure for testing.
fn woke_from_suspend(slept_ms: u64, elapsed_ms: u64, slack_ms: u64) -> bool {
    elapsed_ms > slept_ms.saturating_add(slack_ms)
}

/// Native auto-update scheduler. Replaces the previous frontend `setTimeout`
/// loop so the panel's WebView no longer has to run JS while hidden. Each cycle
/// re-reads the interval and the enabled-plugin set from settings.json (so
/// changes are picked up on the next tick), probes the enabled plugins, and
/// emits `usage:updated`. App Nap stays disabled (see `run`) so this thread
/// keeps firing in the background.
fn start_auto_update_scheduler(
    app_handle: tauri::AppHandle,
    plugins: Vec<Arc<plugin_engine::manifest::LoadedPlugin>>,
    app_data_dir: PathBuf,
    app_version: String,
    detected_ids: HashSet<String>,
) {
    let known_plugin_ids: Vec<String> = plugins.iter().map(|p| p.manifest.id.clone()).collect();

    std::thread::spawn(move || {
        // Wall-clock start of the current wait cycle. Reset after each fire so
        // the next interval is measured from when the last one completed.
        let mut cycle_start_ms = unix_now_ms();
        loop {
            let interval_minutes = local_http_api::read_auto_update_interval_minutes(&app_data_dir);
            let interval_ms = interval_minutes
                .saturating_mul(60)
                .saturating_mul(1000);
            let deadline_ms = cycle_start_ms.saturating_add(interval_ms);
            // Publish the next-run time so the UI can show an accurate countdown
            // even if it queries mid-cycle or after the WebView was throttled
            // while hidden.
            NEXT_UPDATE_AT_MS.store(deadline_ms, Ordering::Relaxed);

            // Wait for the deadline in bounded slices. Sleeping in slices (rather
            // than one long sleep) does two things: a wake-from-sleep that lands
            // past the deadline is noticed within one slice and fires immediately
            // (instead of oversleeping the whole suspend), and — because we
            // remeasure the wall clock around each slice — a wake that lands
            // *before* the deadline (a nap shorter than the interval) is detected
            // as a suspend and also fires. That makes waking the machine refresh
            // the data on its own within one slice, no matter the nap length,
            // without reopening the panel. While the machine is actually asleep
            // the thread does not run, so this costs no battery.
            loop {
                let before_ms = unix_now_ms();
                match scheduler_step(before_ms, deadline_ms, SCHEDULER_MAX_SLICE_MS) {
                    SchedulerAction::Fire => break,
                    SchedulerAction::Sleep(ms) => {
                        std::thread::sleep(Duration::from_millis(ms));
                        let elapsed_ms = unix_now_ms().saturating_sub(before_ms);
                        if woke_from_suspend(ms, elapsed_ms, SUSPEND_DETECT_SLACK_MS) {
                            break;
                        }
                    }
                }
            }
            // Firing now — measure the next cycle from this moment so every path
            // below (including the early `continue`s) starts a fresh interval.
            cycle_start_ms = unix_now_ms();

            let enabled = local_http_api::read_enabled_plugin_ids(&app_data_dir, &known_plugin_ids, &detected_ids);
            if enabled.is_empty() {
                continue;
            }
            let enabled_set: HashSet<String> = enabled.into_iter().collect();
            let selected: Vec<Arc<plugin_engine::manifest::LoadedPlugin>> = plugins
                .iter()
                .filter(|plugin| enabled_set.contains(&plugin.manifest.id))
                .cloned()
                .collect();
            if selected.is_empty() {
                continue;
            }

            let batch_id = Uuid::new_v4().to_string();
            log::info!(
                "auto-update batch {} starting ({} plugins)",
                batch_id,
                selected.len()
            );
            run_probe_batch(
                app_handle.clone(),
                selected,
                app_data_dir.clone(),
                app_version.clone(),
                batch_id,
                true,
            );
        }
    });
}

/// Return the currently enabled, cached usage snapshots so the frontend can
/// hydrate immediately on open (or after the WebView was throttled while
/// hidden) without waiting for a fresh probe.
#[tauri::command]
#[specta::specta]
fn get_cached_usage() -> Vec<local_http_api::CachedPluginSnapshot> {
    local_http_api::enabled_usage_snapshots()
}

/// Unix-ms timestamp of the next scheduled auto-update, or `None` if the
/// scheduler hasn't set it yet. Lets the UI countdown track the real native
/// schedule instead of resetting on every panel open.
#[tauri::command]
#[specta::specta]
fn get_next_update_at() -> Option<f64> {
    match NEXT_UPDATE_AT_MS.load(Ordering::Relaxed) {
        0 => None,
        ms => Some(ms as f64),
    }
}

#[tauri::command]
#[specta::specta]
fn get_log_path(app_handle: tauri::AppHandle) -> Result<String, String> {
    log_path::for_app(&app_handle).map(|path| path.to_string_lossy().to_string())
}

/// Open the macOS System Settings → Notifications pane. The opener plugin doesn't handle the
/// `x-apple.systempreferences:` scheme, so shell out to `open`, which does.
#[tauri::command]
#[specta::specta]
fn open_notification_settings() -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg("x-apple.systempreferences:com.apple.Notifications-Settings.extension")
            .spawn()
            .map_err(|e| format!("Couldn't open notification settings: {e}"))?;
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
fn send_pace_notification(
    app_handle: tauri::AppHandle,
    title: String,
    body: String,
) -> Result<(), String> {
    send_pace_notification_impl(&app_handle, &title, &body)
}

#[cfg(target_os = "macos")]
fn send_pace_notification_impl(
    app_handle: &tauri::AppHandle,
    title: &str,
    body: &str,
) -> Result<(), String> {
    let icon_path = app_handle
        .path()
        .resolve("icons/icon.icns", tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Couldn't resolve notification icon: {e}"))?;
    let icon_path = icon_path
        .to_str()
        .ok_or_else(|| "Notification icon path is not valid UTF-8".to_string())?;

    if let Err(error) = notifications::register_application(app_handle) {
        log::warn!("Failed to set notification application identity: {error}");
    }

    mac_notification_sys::Notification::new()
        .title(title)
        .message(body)
        .app_icon(icon_path)
        .asynchronous(true)
        .send()
        .map(|_| ())
        .map_err(|e| format!("Couldn't send pace notification: {e}"))
}

#[cfg(not(target_os = "macos"))]
fn send_pace_notification_impl(
    app_handle: &tauri::AppHandle,
    title: &str,
    body: &str,
) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;

    app_handle
        .notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|e| format!("Couldn't send pace notification: {e}"))
}

/// Update the global shortcut registration.
/// Pass `null` to disable the shortcut, or a shortcut string like "CommandOrControl+Shift+U".
#[cfg(desktop)]
#[tauri::command]
#[specta::specta]
fn update_global_shortcut(
    app_handle: tauri::AppHandle,
    shortcut: Option<String>,
) -> Result<(), String> {
    let global_shortcut = app_handle.global_shortcut();
    let normalized_shortcut = shortcut.and_then(|value| {
        let trimmed = value.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    });
    let mut managed_shortcut = managed_shortcut_slot()
        .lock()
        .map_err(|e| format!("failed to lock managed shortcut state: {}", e))?;

    if *managed_shortcut == normalized_shortcut {
        log::debug!("Global shortcut unchanged");
        return Ok(());
    }

    let previous_shortcut = managed_shortcut.clone();
    if let Some(existing) = previous_shortcut.as_deref() {
        match global_shortcut.unregister(existing) {
            Ok(()) => {
                // Keep in-memory state aligned with actual registration state.
                *managed_shortcut = None;
            }
            Err(e) => {
                log::warn!(
                    "Failed to unregister existing shortcut '{}': {}",
                    existing,
                    e
                );
            }
        }
    }

    if let Some(shortcut) = normalized_shortcut {
        log::info!("Registering global shortcut: {}", shortcut);
        global_shortcut
            .on_shortcut(shortcut.as_str(), |app, _shortcut, event| {
                handle_global_shortcut(app, event);
            })
            .map_err(|e| format!("Failed to register shortcut '{}': {}", shortcut, e))?;
        *managed_shortcut = Some(shortcut);
    } else {
        log::info!("Global shortcut disabled");
        *managed_shortcut = None;
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
fn list_plugins(state: tauri::State<'_, Mutex<AppState>>) -> Vec<PluginMeta> {
    let plugins = {
        let locked = state.lock().expect("plugin state poisoned");
        locked.plugins.clone()
    };
    log::debug!("list_plugins: {} plugins", plugins.len());

    plugins
        .iter()
        .map(|plugin| {
            // Extract primary candidates: progress lines with primary_order, sorted by order
            let mut candidates: Vec<_> = plugin
                .manifest
                .lines
                .iter()
                .filter(|line| line.line_type == "progress" && line.primary_order.is_some())
                .collect();
            candidates.sort_by_key(|line| line.primary_order.unwrap());
            let primary_candidates: Vec<String> =
                candidates.iter().map(|line| line.label.clone()).collect();

            // The weekly metric is the progress line declared `"period": "weekly"`.
            let weekly_candidate: Option<String> =
                plugin_engine::manifest::weekly_candidate(&plugin.manifest.lines)
                    .map(str::to_string);

            let detected = plugin_engine::manifest::is_plugin_detected(&plugin.manifest);

            PluginMeta {
                id: plugin.manifest.id.clone(),
                name: plugin.manifest.name.clone(),
                icon_url: plugin.icon_data_url.clone(),
                brand_color: plugin.manifest.brand_color.clone(),
                lines: plugin
                    .manifest
                    .lines
                    .iter()
                    .map(|line| ManifestLineDto {
                        line_type: line.line_type.clone(),
                        label: line.label.clone(),
                        scope: line.scope.clone(),
                        escalate_at_percent: line.escalate_at_percent,
                    })
                    .collect(),
                links: plugin
                    .manifest
                    .links
                    .iter()
                    .map(|link| PluginLinkDto {
                        label: link.label.clone(),
                        url: link.url.clone(),
                    })
                    .collect(),
                primary_candidates,
                weekly_candidate,
                multi_tray_lines: plugin
                    .manifest
                    .multi_tray_lines
                    .iter()
                    .take(2)
                    .cloned()
                    .collect(),
                tray_primary_label: plugin.manifest.tray_primary_label.clone(),
                detected,
            }
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            init_panel,
            hide_panel,
            toggle_panel_at_tray_rect,
            open_devtools,
            set_log_level,
            copy_log_path,
            quit_app,
            start_probe_batch,
            list_plugins,
            get_log_path,
            get_cached_usage,
            get_next_update_at,
            update_global_shortcut,
            open_notification_settings,
            notifications::register_notifications,
            notifications::request_notification_permission,
            send_pace_notification,
            onboarding::finish_onboarding,
            onboarding::reset_onboarding,
            whats_new::get_release_notes,
            whats_new::dismiss_whats_new,
            beta_updater::check_beta_update,
            beta_updater::download_beta_update,
            beta_updater::install_beta_update,
            clinepass_key::clinepass_key_status,
            clinepass_key::save_clinepass_key,
            clinepass_key::clear_clinepass_key,
            openrouter_key::openrouter_key_status,
            openrouter_key::save_openrouter_key,
            openrouter_key::clear_openrouter_key
        ])
        .events(tauri_specta::collect_events![
            ProbeResult,
            ProbeBatchComplete,
            beta_updater::BetaUpdateProgress
        ]);

    #[cfg(debug_assertions)]
    {
        specta_builder
            .export(
                specta_typescript::Typescript::default(),
                "../src/bindings.ts",
            )
            .expect("Failed to export TypeScript bindings");
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_nspanel::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets({
                    // A bundled .app has no terminal reading stdout, so the
                    // Stdout target is wasted formatting/IO in release. Keep it
                    // for dev builds; release logs to the log file only.
                    let mut targets =
                        vec![Target::new(TargetKind::LogDir { file_name: None })];
                    if cfg!(debug_assertions) {
                        targets.push(Target::new(TargetKind::Stdout));
                    }
                    targets
                })
                .max_file_size(10_000_000) // 10 MB
                .level(log::LevelFilter::Trace) // Allow all levels; runtime filter via tray menu
                .level_for("hyper", log::LevelFilter::Warn)
                .level_for("reqwest", log::LevelFilter::Warn)
                .level_for("tao", log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::default().build())
        .plugin(tauri_plugin_autostart::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_keylight::init(crate::keylight::config()))
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            specta_builder.mount_events(app);

            std::thread::spawn(crate::keylight::report_on_launch);

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            use tauri::Manager;

            let version = app.package_info().version.to_string();
            log::info!("UsagePal v{} starting", version);

            // Load config early (lazy init via OnceLock, zero-cost after)
            let _proxy = config::get_resolved_proxy();

            let app_data_dir = app.path().app_data_dir().expect("no app data dir");
            let resource_dir = app.path().resource_dir().expect("no resource dir");
            let app_data_dir_tail = app_data_dir
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("unknown");
            let redacted_app_data_dir =
                plugin_engine::host_api::redact_log_message(&app_data_dir.display().to_string());
            log::debug!(
                "app_data_dir: tail={}, path={}",
                app_data_dir_tail,
                redacted_app_data_dir
            );

            let (_, plugins) = plugin_engine::initialize_plugins(&app_data_dir, &resource_dir);
            let known_plugin_ids: Vec<String> =
                plugins.iter().map(|p| p.manifest.id.clone()).collect();
            let detected_ids: HashSet<String> = plugins
                .iter()
                .filter(|p| plugin_engine::manifest::is_plugin_detected(&p.manifest))
                .map(|p| p.manifest.id.clone())
                .collect();
            log::debug!(
                "detected plugins: {:?}",
                detected_ids.iter().cloned().collect::<Vec<_>>()
            );
            let plugin_arcs: Vec<Arc<plugin_engine::manifest::LoadedPlugin>> =
                plugins.into_iter().map(Arc::new).collect();
            let scheduler_plugins = plugin_arcs.clone();
            app.manage(Mutex::new(AppState {
                plugins: plugin_arcs,
                app_data_dir: app_data_dir.clone(),
                app_version: app.package_info().version.to_string(),
            }));

            local_http_api::init(&app_data_dir, known_plugin_ids, detected_ids.clone());
            local_http_api::start_server();

            // Native auto-update scheduler. Runs probes on a background thread so
            // the panel's WebView no longer needs to stay awake to refresh.
            start_auto_update_scheduler(
                app.handle().clone(),
                scheduler_plugins,
                app_data_dir.clone(),
                version.clone(),
                detected_ids,
            );

            tray::create(app.handle())?;

            if let Err(error) = notifications::register_application(app.handle()) {
                log::warn!("Failed to set notification application identity: {error}");
            }

            onboarding::show_setup_window_if_needed(app.handle())?;

            whats_new::show_whats_new_window_if_needed(app.handle())?;

            // Register global shortcut from stored settings
            #[cfg(desktop)]
            {
                use tauri_plugin_store::StoreExt;

                if let Ok(store) = app.handle().store("settings.json") {
                    if let Some(shortcut_value) = store.get(GLOBAL_SHORTCUT_STORE_KEY) {
                        if let Some(shortcut) = shortcut_value.as_str() {
                            let shortcut = shortcut.trim();
                            if !shortcut.is_empty() {
                                let handle = app.handle().clone();
                                log::info!("Registering initial global shortcut: {}", shortcut);
                                if let Err(e) = handle.global_shortcut().on_shortcut(
                                    shortcut,
                                    |app, _shortcut, event| {
                                        handle_global_shortcut(app, event);
                                    },
                                ) {
                                    log::warn!("Failed to register initial global shortcut: {}", e);
                                } else if let Ok(mut managed_shortcut) =
                                    managed_shortcut_slot().lock()
                                {
                                    *managed_shortcut = Some(shortcut.to_string());
                                } else {
                                    log::warn!("Failed to store managed shortcut in memory");
                                }
                            }
                        }
                    }
                }
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_, event| match event {
            tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
                local_http_api::flush_cache();
            }
            _ => {}
        });
}

/// Generates `src/bindings.ts` from the specta command/event registry.
/// Run with: `cargo test export_bindings`
#[cfg(test)]
fn export_bindings() {
    let builder = tauri_specta::Builder::<tauri::Wry>::new()
        .commands(tauri_specta::collect_commands![
            init_panel,
            hide_panel,
            toggle_panel_at_tray_rect,
            open_devtools,
            set_log_level,
            copy_log_path,
            quit_app,
            start_probe_batch,
            list_plugins,
            get_log_path,
            get_cached_usage,
            get_next_update_at,
            update_global_shortcut,
            open_notification_settings,
            notifications::register_notifications,
            notifications::request_notification_permission,
            send_pace_notification,
            onboarding::finish_onboarding,
            onboarding::reset_onboarding,
            whats_new::get_release_notes,
            whats_new::dismiss_whats_new,
            beta_updater::check_beta_update,
            beta_updater::download_beta_update,
            beta_updater::install_beta_update,
            clinepass_key::clinepass_key_status,
            clinepass_key::save_clinepass_key,
            clinepass_key::clear_clinepass_key,
            openrouter_key::openrouter_key_status,
            openrouter_key::save_openrouter_key,
            openrouter_key::clear_openrouter_key
        ])
        .events(tauri_specta::collect_events![
            ProbeResult,
            ProbeBatchComplete,
            beta_updater::BetaUpdateProgress
        ]);

    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("Failed to export TypeScript bindings");
}

#[test]
fn test_export_bindings() {
    export_bindings();
}

#[cfg(test)]
mod tests {
    use super::{
        MAX_CONCURRENT_PROBES, SchedulerAction, probe_worker_count, scheduler_step,
        woke_from_suspend,
    };

    #[test]
    fn probe_worker_count_is_bounded() {
        assert_eq!(probe_worker_count(0), 0);
        assert_eq!(probe_worker_count(1), 1);
        assert_eq!(
            probe_worker_count(MAX_CONCURRENT_PROBES),
            MAX_CONCURRENT_PROBES
        );
        assert_eq!(
            probe_worker_count(MAX_CONCURRENT_PROBES + 1),
            MAX_CONCURRENT_PROBES
        );
    }

    #[test]
    fn scheduler_fires_when_deadline_reached() {
        assert_eq!(scheduler_step(1_000, 1_000, 30_000), SchedulerAction::Fire);
    }

    #[test]
    fn scheduler_fires_when_woken_far_past_deadline() {
        // The machine slept through the deadline: wall clock jumped way past it.
        assert_eq!(
            scheduler_step(60_000_000, 1_000, 30_000),
            SchedulerAction::Fire
        );
    }

    #[test]
    fn scheduler_sleeps_a_capped_slice_when_deadline_is_far() {
        // 5 minutes out, capped to a 30s slice so a wake mid-wait is noticed
        // within one slice instead of oversleeping the whole nap.
        assert_eq!(
            scheduler_step(0, 300_000, 30_000),
            SchedulerAction::Sleep(30_000)
        );
    }

    #[test]
    fn scheduler_sleeps_exactly_the_remainder_near_the_deadline() {
        // Within one slice of the deadline: sleep just the remainder so we don't
        // add pointless wakeups at the tail of the wait.
        assert_eq!(
            scheduler_step(295_000, 300_000, 30_000),
            SchedulerAction::Sleep(5_000)
        );
    }

    #[test]
    fn suspend_detected_when_wall_clock_jumps_past_the_slice() {
        // Asked to sleep 30s but two hours of wall clock elapsed: the machine was
        // suspended mid-slice and just woke, so we should refresh on wake even
        // though the interval deadline may still be in the future.
        assert!(woke_from_suspend(30_000, 7_200_000, 5_000));
    }

    #[test]
    fn no_suspend_for_a_normal_slice_with_jitter() {
        // A slice that slept about as long as requested (plus a little scheduler
        // jitter) is not a wake-from-suspend and must not trigger a refresh.
        assert!(!woke_from_suspend(30_000, 30_400, 5_000));
    }

    #[test]
    fn no_suspend_right_at_the_slack_boundary() {
        // Elapsed exactly slept + slack is still within tolerance (strict `>`),
        // so it is not treated as a suspend.
        assert!(!woke_from_suspend(30_000, 35_000, 5_000));
        assert!(woke_from_suspend(30_000, 35_001, 5_000));
    }

    #[test]
    fn suspend_detected_for_a_nap_shorter_than_the_interval() {
        // Even a short nap (a couple of minutes) that never crosses the interval
        // deadline is a wake-from-suspend and refreshes on wake.
        assert!(woke_from_suspend(30_000, 120_000, 5_000));
    }
}
