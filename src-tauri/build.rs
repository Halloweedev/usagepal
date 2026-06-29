use std::fs;

fn main() {
    forward_keylight_env();
    tauri_build::build();
}

/// Inject publishable KEYLIGHT_* values from the repo-root `.env` (gitignored)
/// into the crate build so `option_env!` can read them. Missing file is fine —
/// the app falls back to empty placeholders and still builds.
fn forward_keylight_env() {
    println!("cargo:rerun-if-changed=../.env");
    let Ok(contents) = fs::read_to_string("../.env") else {
        return;
    };
    for line in contents.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if !key.starts_with("KEYLIGHT_") {
            continue;
        }
        let value = value.trim().trim_matches('"').trim_matches('\'');
        println!("cargo:rustc-env={key}={value}");
    }
}
