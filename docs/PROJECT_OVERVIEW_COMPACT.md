# Project Hyper Compact Overview
## Core Map
- `package.json` — Bun/Vite workspace for the UsagePal Tauri desktop app.
- `src/` — React UI for overview, provider detail, settings, dialogs, and tray-facing state.
- `src-tauri/` — Rust host for windowing, tray, plugin execution, local API, and config.
- `plugins/` — Provider probes and tests bundled into the desktop app at build time.
- `docs/` — User and maintainer docs for getting started, notifications, proxying, local API, plugins, and providers.
## API Surfaces
- Local HTTP API — documented in `docs/local-http-api.md`, implemented under `src-tauri/src/local_http_api/`.
- Plugin host API — Rust bridge in `src-tauri/src/plugin_engine/host_api.rs`, schema docs in `docs/plugins/`.
- Tauri commands/events — app shell, onboarding, notification registration, settings, pace notifications, provider key dialogs, beta updater, log-level, copy-log, and quit actions flow through `src-tauri/src/lib.rs` plus frontend hooks.
- `src/bindings.ts` plus `src/lib/plugin-types.ts` — generated tauri-specta IPC types feed frontend state while manual `invoke()`/`listen()` calls stay in place.
## Modules / Components
- `src/App.tsx` — top-level app orchestration for plugin data, settings bootstrap, probing, and tray updates.
- `src/components/onboarding/` — first-run setup flow with onboarding-only product education.
- `src/pages/overview.tsx` — primary provider overview screen with no retirement banner in this fork.
- `src/pages/settings.tsx` plus `src/components/settings-app-menu.tsx` — app preferences, Debug modal beta opt-in, collapsible plugin toggles, shortcuts, and bottom App Menu actions.
- `src/components/` — reusable dialogs, provider API key modals, cards, nav, footer, skeletons, and UI primitives.
- `src/lib/settings.ts` — persisted frontend settings, onboarding completion, notification presets, and migration helpers.
- `src-tauri/src/onboarding.rs` plus `src-tauri/src/notifications.rs` — setup window lifecycle, onboarding completion commands, notification registration, and permission request commands.
- `src-tauri/src/plugin_engine/` — manifest loading, runtime sandboxing, and host capabilities for plugins.
## Infrastructure / Cross-Cutting
- `src-tauri/tauri.conf.json` — app metadata, updater endpoint/public key, app-only Tauri bundle target, and embedded resources.
- `lutin.yml` plus `scripts/build-release.sh` — local DMG layout/release packaging around the Tauri-built `.app`.
- `.github/workflows/publish.yml` — tag-triggered macOS release pipeline building updater artifacts via Tauri and DMGs via Lutin.
- `src-tauri/src/config.rs` — optional proxy config loaded from `~/.usagepal/config.json`.
- `src-tauri/src/log_path.rs` — log file naming for UsagePal app logs.
- `src-tauri/src/tray.rs` — menu bar icon opens the panel directly; no native tray context menu is attached.
- Pace notifications — `src/hooks/app/use-pace-notifications.ts` calls `send_pace_notification`, which applies bundled macOS icon resources.
- `plugins/test-helpers.js` and `src/**/*.test.*` — shared test scaffolding across frontend and plugin suites.
## Security Rails
- Proxy config is opt-in and parsed once at startup before request use.
- Plugin execution stays behind the Rust host API surface and bundled plugin manifest/runtime checks.
- Tauri CSP permits `blob:` images so release builds can rasterize dynamic menu bar status icons.
- Copilot keychain cache now uses the `UsagePal-copilot` service name in this fork.
- Provider API key status commands expose booleans only; saved keys are never read back into the webview.
## Phase Status
- Imported from OpenUsage `v0.6.28` source archive into this repo.
- Core app/product branding renamed to UsagePal across desktop metadata, UI copy, docs, and selected plugin identity strings.
- Upstream retirement banner removed from the overview UI for this fork.
- Removed changelog, GitHub links, Help button, and aptabase analytics while enabling UsagePal updater releases.
- Menu bar icon left-click opens the app panel on Home; Settings bottom App Menu holds old tray actions. Menubar icon styles: Plugin, Donut, Bars, and **Multi** (up to 3 icons with session + weekly per provider).
- Frontend and Rust dependency bundles trimmed (aptabase, updater config, permissions).
## Fast Locate Cheats
- Rename/version-sensitive metadata — `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, and `lutin.yml`.
- Provider plugin behavior — `plugins/<provider>/plugin.js` and matching `plugin.test.js`.
- Tray/menu-bar behavior — `src/lib/tray-tooltip.ts`, `src/hooks/app/use-tray-icon.ts`, `src-tauri/src/tray.rs`.
- Settings bootstrap/tests — `src/hooks/app/use-settings-bootstrap.ts`, `src/lib/settings.ts`, `src/App.test.tsx`.
## Update Log (Last 5)
- 2026-07-08 — Removed post-onboarding contextual tip cards and moved education into setup.
- 2026-07-08 — Added getting-started docs and first-run notification setup guidance.
- 2026-07-08 — Added native onboarding setup-window commands and reusable notification registration module.
- 2026-07-08 — Added frontend onboarding completion persistence and bulk notification store action.
- 2026-07-07 — Added UsagePal-managed ClinePass API key dialog and Rust key commands.
