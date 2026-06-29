pub mod host_api;
pub mod manifest;
pub mod runtime;

use manifest::LoadedPlugin;
use std::path::{Path, PathBuf};

const RETIRED_BUNDLED_PLUGIN_IDS: &[&str] = &["windsurf"];

pub fn initialize_plugins(
    app_data_dir: &Path,
    resource_dir: &Path,
) -> (PathBuf, Vec<LoadedPlugin>) {
    if let Some(dev_dir) = find_dev_plugins_dir() {
        if !is_dir_empty(&dev_dir) {
            let plugins = load_active_plugins_from_dir(&dev_dir);
            return (dev_dir, plugins);
        }
    }

    let install_dir = app_data_dir.join("plugins");
    if let Err(err) = std::fs::create_dir_all(&install_dir) {
        log::warn!(
            "failed to create install dir {}: {}",
            install_dir.display(),
            err
        );
    }

    let bundled_dir = resolve_bundled_dir(resource_dir);
    if bundled_dir.exists() {
        copy_dir_recursive(&bundled_dir, &install_dir);
        remove_retired_bundled_plugins(&install_dir);
    }

    let plugins = load_active_plugins_from_dir(&install_dir);
    (install_dir, plugins)
}

fn load_active_plugins_from_dir(plugins_dir: &Path) -> Vec<LoadedPlugin> {
    manifest::load_plugins_from_dir(plugins_dir)
        .into_iter()
        .filter(|plugin| !is_retired_bundled_plugin_id(&plugin.manifest.id))
        .collect()
}

fn is_retired_bundled_plugin_id(id: &str) -> bool {
    RETIRED_BUNDLED_PLUGIN_IDS.contains(&id)
}

fn find_dev_plugins_dir() -> Option<PathBuf> {
    let cwd = std::env::current_dir().ok()?;
    let direct = cwd.join("plugins");
    if direct.exists() {
        return Some(direct);
    }
    let parent = cwd.join("..").join("plugins");
    if parent.exists() {
        return Some(parent);
    }
    None
}

fn resolve_bundled_dir(resource_dir: &Path) -> PathBuf {
    let nested = resource_dir.join("resources/bundled_plugins");
    if nested.exists() {
        nested
    } else {
        resource_dir.join("bundled_plugins")
    }
}

fn is_dir_empty(path: &Path) -> bool {
    match std::fs::read_dir(path) {
        Ok(mut entries) => entries.next().is_none(),
        Err(err) => {
            log::warn!("failed to read dir {}: {}", path.display(), err);
            true
        }
    }
}

fn remove_retired_bundled_plugins(install_dir: &Path) {
    for id in RETIRED_BUNDLED_PLUGIN_IDS {
        let plugin_dir = install_dir.join(id);
        if !plugin_dir.is_dir() || !plugin_dir_has_id(&plugin_dir, id) {
            continue;
        }

        if let Err(err) = std::fs::remove_dir_all(&plugin_dir) {
            log::warn!(
                "failed to remove retired bundled plugin {}: {}",
                plugin_dir.display(),
                err
            );
        }
    }
}

fn plugin_dir_has_id(plugin_dir: &Path, expected_id: &str) -> bool {
    let manifest_path = plugin_dir.join("plugin.json");
    let Ok(text) = std::fs::read_to_string(&manifest_path) else {
        return false;
    };
    let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) else {
        return false;
    };
    value
        .get("id")
        .and_then(|id| id.as_str())
        .is_some_and(|id| id == expected_id)
}

fn copy_dir_recursive(src: &Path, dst: &Path) {
    match std::fs::read_dir(src) {
        Ok(entries) => {
            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(err) => {
                        log::warn!("failed to read entry in {}: {}", src.display(), err);
                        continue;
                    }
                };
                let src_path = entry.path();
                let dst_path = dst.join(entry.file_name());
                let file_type = match entry.file_type() {
                    Ok(file_type) => file_type,
                    Err(err) => {
                        log::warn!(
                            "failed to read file type for {}: {}",
                            src_path.display(),
                            err
                        );
                        continue;
                    }
                };
                if file_type.is_symlink() {
                    continue;
                }
                if file_type.is_dir() {
                    if let Err(err) = std::fs::create_dir_all(&dst_path) {
                        log::warn!("failed to create dir {}: {}", dst_path.display(), err);
                        continue;
                    }
                    copy_dir_recursive(&src_path, &dst_path);
                } else if file_type.is_file() {
                    if let Err(err) = std::fs::copy(&src_path, &dst_path) {
                        log::warn!(
                            "failed to copy {} to {}: {}",
                            src_path.display(),
                            dst_path.display(),
                            err
                        );
                    }
                }
            }
        }
        Err(err) => {
            log::warn!("failed to read dir {}: {}", src.display(), err);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct TempDir {
        path: PathBuf,
    }

    impl TempDir {
        fn new(name: &str) -> Self {
            let suffix = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock before unix epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "usagepal-plugin-engine-{}-{}-{}",
                name,
                std::process::id(),
                suffix
            ));
            fs::create_dir_all(&path).expect("create temp dir");
            Self { path }
        }

        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    struct CurrentDirGuard {
        original: PathBuf,
    }

    impl CurrentDirGuard {
        fn enter(path: &Path) -> Self {
            let original = std::env::current_dir().expect("read current dir");
            std::env::set_current_dir(path).expect("set current dir");
            Self { original }
        }
    }

    impl Drop for CurrentDirGuard {
        fn drop(&mut self) {
            let _ = std::env::set_current_dir(&self.original);
        }
    }

    fn write_plugin(parent: &Path, id: &str, name: &str) {
        let plugin_dir = parent.join(id);
        write_plugin_at(&plugin_dir, id, name);
    }

    fn write_plugin_at(plugin_dir: &Path, id: &str, name: &str) {
        fs::create_dir_all(&plugin_dir).expect("create plugin dir");
        fs::write(
            plugin_dir.join("plugin.json"),
            format!(
                r##"{{
  "schemaVersion": 1,
  "id": "{}",
  "name": "{}",
  "version": "0.0.1",
  "entry": "plugin.js",
  "icon": "icon.svg",
  "brandColor": "#000000",
  "lines": []
}}"##,
                id, name
            ),
        )
        .expect("write plugin manifest");
        fs::write(
            plugin_dir.join("plugin.js"),
            format!(
                r#"globalThis.__openusage_plugin = {{ id: "{}", probe: () => ({{ lines: [] }}) }}"#,
                id
            ),
        )
        .expect("write plugin script");
        fs::write(
            plugin_dir.join("icon.svg"),
            r#"<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>"#,
        )
        .expect("write plugin icon");
    }

    #[test]
    #[serial]
    fn initialize_plugins_removes_retired_windsurf_without_removing_custom_plugins() {
        let root = TempDir::new("retired");
        let _cwd = CurrentDirGuard::enter(root.path());
        let app_data_dir = root.path().join("app-data");
        let install_dir = app_data_dir.join("plugins");
        let resource_dir = root.path().join("resources");
        let bundled_dir = resource_dir.join("bundled_plugins");

        write_plugin(&install_dir, "windsurf", "Windsurf");
        write_plugin(&install_dir, "custom", "Custom");
        write_plugin(&bundled_dir, "devin", "Devin");

        let (loaded_dir, plugins) = initialize_plugins(&app_data_dir, &resource_dir);
        let ids: Vec<_> = plugins
            .iter()
            .map(|plugin| plugin.manifest.id.as_str())
            .collect();

        assert_eq!(loaded_dir, install_dir);
        assert!(!loaded_dir.join("windsurf").exists());
        assert!(loaded_dir.join("custom").exists());
        assert!(loaded_dir.join("devin").exists());
        assert_eq!(ids, vec!["custom", "devin"]);
    }

    #[test]
    #[serial]
    fn initialize_plugins_skips_retired_plugin_even_when_cleanup_does_not_remove_it() {
        let root = TempDir::new("retired-skip");
        let _cwd = CurrentDirGuard::enter(root.path());
        let app_data_dir = root.path().join("app-data");
        let install_dir = app_data_dir.join("plugins");
        let resource_dir = root.path().join("resources");
        fs::create_dir_all(&resource_dir).expect("create resource dir");

        let mismatched_dir = install_dir.join("legacy-name");
        write_plugin_at(&mismatched_dir, "windsurf", "Windsurf");

        let (_loaded_dir, plugins) = initialize_plugins(&app_data_dir, &resource_dir);

        assert!(mismatched_dir.exists());
        assert!(plugins.is_empty());
    }
}
