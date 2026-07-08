use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::path::BaseDirectory;
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager};
use tauri_plugin_store::StoreExt;

use crate::panel::{toggle_panel, toggle_panel_at_tray_rect};

const LOG_LEVEL_STORE_KEY: &str = "logLevel";
const MENU_OPEN: &str = "tray_open";
const MENU_QUIT: &str = "tray_quit";

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

fn build_tray_menu(app_handle: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let open_item = MenuItem::with_id(app_handle, MENU_OPEN, "Open UsagePal", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app_handle)?;
    let quit_item = MenuItem::with_id(app_handle, MENU_QUIT, "Quit UsagePal", true, None::<&str>)?;

    Menu::with_items(app_handle, &[&open_item, &separator, &quit_item])
}

fn show_tray_context_menu(app_handle: &AppHandle) {
    let Some(window) = app_handle.get_webview_window("main") else {
        return;
    };
    let menu = match build_tray_menu(app_handle) {
        Ok(menu) => menu,
        Err(error) => {
            log::warn!("failed to build tray context menu: {error}");
            return;
        }
    };
    if let Err(error) = window.popup_menu(&menu) {
        log::warn!("failed to show tray context menu: {error}");
    }
}

pub fn create(app_handle: &AppHandle) -> tauri::Result<()> {
    let tray_icon_path = app_handle
        .path()
        .resolve("icons/tray-icon.png", BaseDirectory::Resource)?;
    let icon = Image::from_path(tray_icon_path)?;

    // Load persisted log level
    log::set_max_level(get_stored_log_level(app_handle));

    app_handle.on_menu_event(|app_handle, event| match event.id.as_ref() {
        MENU_OPEN => toggle_panel(app_handle),
        MENU_QUIT => app_handle.exit(0),
        _ => {}
    });

    TrayIconBuilder::with_id("tray")
        .icon(icon)
        .icon_as_template(true)
        .tooltip("UsagePal")
        .on_tray_icon_event(|tray, event| {
            let app_handle = tray.app_handle();

            if let TrayIconEvent::Click {
                button,
                button_state,
                rect,
                ..
            } = event
            {
                if button_state != MouseButtonState::Up {
                    return;
                }

                match button {
                    MouseButton::Left => {
                        log::info!("tray click: button=Left");
                        toggle_panel_at_tray_rect(app_handle, rect.position, rect.size);
                    }
                    MouseButton::Right => {
                        log::info!("tray click: button=Right");
                        show_tray_context_menu(app_handle);
                    }
                    _ => {}
                }
            }
        })
        .build(app_handle)?;

    Ok(())
}
