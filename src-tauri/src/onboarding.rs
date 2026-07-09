use tauri::{Emitter, Manager};
use tauri_plugin_store::StoreExt;

pub const SETTINGS_STORE: &str = "settings.json";
pub const ONBOARDING_COMPLETED_KEY: &str = "onboardingCompleted";
pub const ONBOARDING_COMPLETED_AT_KEY: &str = "onboardingCompletedAt";

pub fn onboarding_completed_from_value(value: Option<&serde_json::Value>) -> bool {
    matches!(value, Some(serde_json::Value::Bool(true)))
}

pub fn is_onboarding_completed(app_handle: &tauri::AppHandle) -> bool {
    let value = app_handle
        .store(SETTINGS_STORE)
        .ok()
        .and_then(|store| store.get(ONBOARDING_COMPLETED_KEY));
    onboarding_completed_from_value(value.as_ref())
}

pub fn show_setup_window_if_needed(app_handle: &tauri::AppHandle) -> tauri::Result<()> {
    if is_onboarding_completed(app_handle) {
        return Ok(());
    }

    if let Some(window) = app_handle.get_webview_window("setup") {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        app_handle,
        "setup",
        tauri::WebviewUrl::App("index.html#/setup".into()),
    )
    .title("UsagePal Setup")
    .inner_size(560.0, 620.0)
    .min_inner_size(560.0, 620.0)
    .resizable(false)
    // Chromeless: the web header carries the drag region; Escape dismisses.
    // Transparent so the CSS rounded corners are the real window shape.
    .decorations(false)
    .transparent(true)
    .center()
    .visible(true)
    .focused(true)
    .build()?;

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
        .map_err(|error| format!("failed to save onboarding completion: {error}"))
}

#[tauri::command]
#[specta::specta]
pub fn finish_onboarding(app_handle: tauri::AppHandle, open_settings: bool) -> Result<(), String> {
    save_onboarding_completion(&app_handle)?;

    // The onboarding window saved the provider selection just before this
    // call; tell the running panel to reload plugin settings from the store.
    if let Err(error) = app_handle.emit("plugins:changed", ()) {
        log::error!("failed to emit plugins:changed: {error}");
    }

    if let Some(window) = app_handle.get_webview_window("setup") {
        window
            .close()
            .map_err(|error| format!("failed to close setup window: {error}"))?;
    }

    crate::panel::show_panel_from_tray(
        &app_handle,
        if open_settings { "settings" } else { "home" },
    );

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
    store
        .save()
        .map_err(|error| format!("failed to save onboarding reset: {error}"))
}

#[cfg(test)]
mod tests {
    use super::onboarding_completed_from_value;

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
