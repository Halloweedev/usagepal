use tauri::image::Image;
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

use crate::panel::toggle_panel_at_tray_rect;

const LOG_LEVEL_STORE_KEY: &str = "logLevel";

fn get_stored_log_level(app_handle: &AppHandle) -> log::LevelFilter {
    let store = match app_handle.store("settings.json") {
        Ok(s) => s,
        Err(_) => return log::LevelFilter::Error,
    };
    let value = store.get(LOG_LEVEL_STORE_KEY);
    let level_str = value.and_then(|v| v.as_str().map(|s| s.to_string()));
    match level_str.as_deref() {
        Some("error") => log::LevelFilter::Error,
        Some("warn") => log::LevelFilter::Warn,
        Some("info") => log::LevelFilter::Info,
        Some("debug") => log::LevelFilter::Debug,
        Some("trace") => log::LevelFilter::Trace,
        _ => log::LevelFilter::Error, // Default: least verbose
    }
}

pub fn create(app_handle: &AppHandle) -> tauri::Result<()> {
    let tray_icon_path = app_handle
        .path()
        .resolve("icons/tray-icon.png", BaseDirectory::Resource)?;
    let icon = Image::from_path(tray_icon_path)?;

    // Load persisted log level
    log::set_max_level(get_stored_log_level(app_handle));

    TrayIconBuilder::with_id("tray")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("UsagePal")
        .on_tray_icon_event(|tray, event| {
            let app_handle = tray.app_handle();

            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state,
                rect,
                ..
            } = event
            {
                log::info!("tray click: button=Left, state={:?}", button_state);
                if button_state == MouseButtonState::Up {
                    toggle_panel_at_tray_rect(app_handle, rect.position, rect.size);
                }
            }
        })
        .build(app_handle)?;

    Ok(())
}
