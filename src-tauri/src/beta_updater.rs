use std::sync::{
    Mutex, OnceLock,
    atomic::{AtomicBool, Ordering},
};

use reqwest::Url;
use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::{Update, UpdaterExt};

const BETA_UPDATE_ENDPOINT: &str =
    "https://github.com/Halloweedev/usagepal/releases/download/beta-feed/latest_beta.json";
const BETA_UPDATE_PROGRESS_EVENT: &str = "beta-update:progress";

struct PendingBetaUpdate {
    update: Update,
    bytes: Option<Vec<u8>>,
}

fn pending_update_slot() -> &'static Mutex<Option<PendingBetaUpdate>> {
    static SLOT: OnceLock<Mutex<Option<PendingBetaUpdate>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BetaUpdateInfo {
    pub version: String,
}

#[derive(Debug, Clone, Serialize, Type, tauri_specta::Event)]
#[tauri_specta(event_name = "beta-update:progress")]
#[serde(tag = "event", content = "data")]
pub enum BetaUpdateProgress {
    Started { content_length: Option<f64> },
    Progress { chunk_length: f64 },
    Finished,
}

fn beta_endpoint() -> Result<Url, String> {
    Url::parse(BETA_UPDATE_ENDPOINT)
        .map_err(|error| format!("invalid beta update endpoint: {error}"))
}

#[tauri::command]
#[specta::specta]
pub async fn check_beta_update(app_handle: AppHandle) -> Result<Option<BetaUpdateInfo>, String> {
    let updater = app_handle
        .updater_builder()
        .endpoints(vec![beta_endpoint()?])
        .map_err(|error| format!("failed to configure beta updater: {error}"))?
        .build()
        .map_err(|error| format!("failed to build beta updater: {error}"))?;

    let update = updater
        .check()
        .await
        .map_err(|error| format!("failed to check beta update: {error}"))?;

    let mut pending_update = pending_update_slot()
        .lock()
        .map_err(|error| error.to_string())?;

    if let Some(update) = update {
        let version = update.version.clone();
        *pending_update = Some(PendingBetaUpdate {
            update,
            bytes: None,
        });
        return Ok(Some(BetaUpdateInfo { version }));
    }

    *pending_update = None;
    Ok(None)
}

#[tauri::command]
#[specta::specta]
pub async fn download_beta_update(app_handle: AppHandle) -> Result<(), String> {
    let update = pending_update_slot()
        .lock()
        .map_err(|error| error.to_string())?
        .as_ref()
        .map(|pending| pending.update.clone())
        .ok_or_else(|| "no beta update is ready to download".to_string())?;

    let started = AtomicBool::new(false);
    let bytes = update
        .download(
            |chunk_length, content_length| {
                if !started.swap(true, Ordering::Relaxed) {
                    let _ = app_handle.emit(
                        BETA_UPDATE_PROGRESS_EVENT,
                        BetaUpdateProgress::Started { content_length: content_length.map(|v| v as f64) },
                    );
                }
                let _ = app_handle.emit(
                    BETA_UPDATE_PROGRESS_EVENT,
                    BetaUpdateProgress::Progress { chunk_length: chunk_length as f64 },
                );
            },
            || {
                let _ = app_handle.emit(BETA_UPDATE_PROGRESS_EVENT, BetaUpdateProgress::Finished);
            },
        )
        .await
        .map_err(|error| format!("failed to download beta update: {error}"))?;

    if let Some(pending) = pending_update_slot()
        .lock()
        .map_err(|error| error.to_string())?
        .as_mut()
    {
        pending.bytes = Some(bytes);
    }

    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn install_beta_update() -> Result<(), String> {
    let pending = pending_update_slot()
        .lock()
        .map_err(|error| error.to_string())?
        .take()
        .ok_or_else(|| "no beta update is ready to install".to_string())?;

    let bytes = pending
        .bytes
        .ok_or_else(|| "beta update has not been downloaded".to_string())?;

    pending
        .update
        .install(bytes)
        .map_err(|error| format!("failed to install beta update: {error}"))
}
