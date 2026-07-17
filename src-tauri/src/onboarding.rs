use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

pub const SETTINGS_STORE: &str = "settings.json";
pub const ONBOARDING_COMPLETED_KEY: &str = "onboardingCompleted";
pub const ONBOARDING_COMPLETED_AT_KEY: &str = "onboardingCompletedAt";

// Store-independent completion marker. The settings store silently loads as
// empty when settings.json is corrupt or truncated, which would re-trigger
// onboarding on every such launch; this file survives that failure mode.
const COMPLETION_MARKER_FILE: &str = "onboarding-complete";

pub fn onboarding_completed_from_value(value: Option<&serde_json::Value>) -> bool {
    matches!(value, Some(serde_json::Value::Bool(true)))
}

pub fn onboarding_completed(store_flag: Option<&serde_json::Value>, marker_exists: bool) -> bool {
    onboarding_completed_from_value(store_flag) || marker_exists
}

fn completion_marker_path(app_handle: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    match app_handle.path().app_data_dir() {
        Ok(dir) => Some(dir.join(COMPLETION_MARKER_FILE)),
        Err(error) => {
            log::warn!("failed to resolve app data dir for onboarding marker: {error}");
            None
        }
    }
}

fn completion_marker_exists(app_handle: &tauri::AppHandle) -> bool {
    completion_marker_path(app_handle).is_some_and(|path| path.exists())
}

fn write_completion_marker(app_handle: &tauri::AppHandle) {
    let Some(path) = completion_marker_path(app_handle) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Err(error) = std::fs::write(&path, b"") {
        log::warn!("failed to write onboarding completion marker: {error}");
    }
}

pub fn is_onboarding_completed(app_handle: &tauri::AppHandle) -> bool {
    let value = app_handle
        .store(SETTINGS_STORE)
        .ok()
        .and_then(|store| store.get(ONBOARDING_COMPLETED_KEY));
    let marker = completion_marker_exists(app_handle);
    let flag = onboarding_completed_from_value(value.as_ref());
    if marker && !flag {
        log::warn!(
            "onboarding flag missing from settings store but completion marker exists; \
             settings.json may have been reset or corrupted"
        );
    }
    if flag && !marker {
        // Backfill for installs that completed onboarding before the marker
        // existed.
        write_completion_marker(app_handle);
    }
    onboarding_completed(value.as_ref(), marker)
}

pub fn show_setup_window_if_needed(app_handle: &tauri::AppHandle) -> tauri::Result<()> {
    if is_onboarding_completed(app_handle) {
        return Ok(());
    }

    crate::panel::create_chromeless_window(
        app_handle,
        "setup",
        "index.html#/setup",
        "UsagePal Setup",
    )?;

    Ok(())
}

fn save_onboarding_completion(app_handle: &tauri::AppHandle) -> Result<(), String> {
    let store = app_handle
        .store(SETTINGS_STORE)
        .map_err(|error| format!("failed to open settings store: {error}"))?;
    store.set(ONBOARDING_COMPLETED_KEY, serde_json::json!(true));
    store.set(
        ONBOARDING_COMPLETED_AT_KEY,
        serde_json::json!(crate::unix_now_ms()),
    );
    store
        .save()
        .map_err(|error| format!("failed to save onboarding completion: {error}"))?;
    write_completion_marker(app_handle);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn finish_onboarding(app_handle: tauri::AppHandle, open_settings: bool) -> Result<(), String> {
    save_onboarding_completion(&app_handle)?;
    crate::whats_new::save_last_seen_version(
        &app_handle,
        &app_handle.package_info().version.to_string(),
    )?;

    // The onboarding window saved the provider selection just before this
    // call; tell the running panel to reload plugin settings from the store.
    if let Err(error) = app_handle.emit("plugins:changed", ()) {
        log::error!("failed to emit plugins:changed: {error}");
    }

    crate::panel::close_window_and_show_panel(
        &app_handle,
        "setup",
        if open_settings { "settings" } else { "home" },
    )?;

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn reset_onboarding(app_handle: tauri::AppHandle) -> Result<(), String> {
    let store = app_handle
        .store(SETTINGS_STORE)
        .map_err(|error| format!("failed to open settings store: {error}"))?;
    store.delete(ONBOARDING_COMPLETED_KEY);
    store.delete(ONBOARDING_COMPLETED_AT_KEY);
    store.delete(crate::whats_new::LAST_SEEN_VERSION_KEY);
    store
        .save()
        .map_err(|error| format!("failed to save onboarding reset: {error}"))?;
    if let Some(path) = completion_marker_path(&app_handle) {
        if let Err(error) = std::fs::remove_file(&path) {
            if error.kind() != std::io::ErrorKind::NotFound {
                return Err(format!(
                    "failed to remove onboarding completion marker: {error}"
                ));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{onboarding_completed, onboarding_completed_from_value};

    #[test]
    fn marker_counts_as_completed_when_store_flag_missing() {
        assert!(onboarding_completed(None, true));
        assert!(onboarding_completed(Some(&serde_json::json!(false)), true));
    }

    #[test]
    fn fresh_install_shows_onboarding() {
        assert!(!onboarding_completed(None, false));
    }

    #[test]
    fn store_flag_alone_counts_as_completed() {
        assert!(onboarding_completed(Some(&serde_json::json!(true)), false));
    }

    #[test]
    fn onboarding_completed_defaults_to_false() {
        assert!(!onboarding_completed_from_value(None));
        assert!(!onboarding_completed_from_value(Some(&serde_json::json!(
            false
        ))));
        assert!(!onboarding_completed_from_value(Some(&serde_json::json!(
            "true"
        ))));
    }

    #[test]
    fn onboarding_completed_reads_true() {
        assert!(onboarding_completed_from_value(Some(&serde_json::json!(
            true
        ))));
    }
}
