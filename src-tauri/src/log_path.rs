use std::path::{Path, PathBuf};

use tauri::Manager;

pub fn for_app(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let package_name = app_handle.package_info().name.clone();
    app_handle
        .path()
        .app_log_dir()
        .map(|dir| log_file_path(&dir, &package_name))
        .map_err(|error| error.to_string())
}

fn log_file_path(log_dir: &Path, package_name: &str) -> PathBuf {
    log_dir.join(package_name).with_extension("log")
}

#[cfg(test)]
mod tests {
    use super::log_file_path;
    use std::path::PathBuf;

    #[test]
    fn builds_log_file_path_from_log_dir() {
        let path = log_file_path(&PathBuf::from("/logs/usagepal"), "UsagePal");

        assert_eq!(
            path,
            PathBuf::from("/logs/usagepal/UsagePal.log")
        );
    }
}
