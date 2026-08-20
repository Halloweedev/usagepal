use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "macos")]
mod macos;
#[cfg(not(target_os = "macos"))]
mod other;

#[cfg(target_os = "macos")]
pub use macos::*;
#[cfg(not(target_os = "macos"))]
pub use other::*;

/// Build (or show) a 560×620 chromeless, transparent, centered window — the shape
/// shared by the onboarding setup window and the what's-new window. If a window
/// with the given label already exists, just show and focus it.
pub fn create_chromeless_window(
    app_handle: &AppHandle,
    label: &str,
    url: &str,
    title: &str,
) -> tauri::Result<()> {
    if let Some(window) = app_handle.get_webview_window(label) {
        window.show()?;
        window.set_focus()?;
        return Ok(());
    }

    WebviewWindowBuilder::new(
        app_handle,
        label,
        WebviewUrl::App(url.into()),
    )
    .title(title)
    .inner_size(560.0, 620.0)
    .min_inner_size(560.0, 620.0)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .center()
    .visible(true)
    .focused(true)
    .build()?;

    Ok(())
}
