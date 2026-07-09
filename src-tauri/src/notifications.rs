use tauri_plugin_notification::NotificationExt;

#[cfg(target_os = "macos")]
pub fn register_application_identifier(identifier: &str) -> Result<(), String> {
    application_registration_result(mac_notification_sys::set_application(identifier))
}

#[cfg(target_os = "macos")]
fn application_registration_result(
    result: mac_notification_sys::error::NotificationResult<()>,
) -> Result<(), String> {
    match result {
        Ok(())
        | Err(mac_notification_sys::error::Error::Application(
            mac_notification_sys::error::ApplicationError::AlreadySet(_),
        )) => Ok(()),
        Err(error) => Err(format!(
            "failed to set notification application identity: {error}"
        )),
    }
}

#[cfg(not(target_os = "macos"))]
pub fn register_application_identifier(_identifier: &str) -> Result<(), String> {
    Ok(())
}

pub fn register_application(app_handle: &tauri::AppHandle) -> Result<(), String> {
    register_application_identifier(&app_handle.config().identifier)
}

#[tauri::command]
#[specta::specta]
pub fn register_notifications(app_handle: tauri::AppHandle) -> Result<(), String> {
    register_application(&app_handle)
}

#[tauri::command]
#[specta::specta]
pub fn request_notification_permission(app_handle: tauri::AppHandle) -> Result<String, String> {
    register_application(&app_handle)?;
    app_handle
        .notification()
        .request_permission()
        .map(|state| state.to_string())
        .map_err(|error| format!("failed to request notification permission: {error}"))
}

#[cfg(test)]
mod tests {
    #[test]
    fn notification_registration_already_set_is_ok() {
        #[cfg(target_os = "macos")]
        {
            super::application_registration_result(Err(
                mac_notification_sys::error::ApplicationError::AlreadySet(
                    "com.robinebers.openusage.test".to_string(),
                )
                .into(),
            ))
            .expect("AlreadySet should be treated as success");
        }

        #[cfg(not(target_os = "macos"))]
        {
            super::register_application_identifier("com.robinebers.openusage.test")
                .expect("non-macOS registration should be a no-op");
        }
    }
}
