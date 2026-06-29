# Project Hyper Compact Overview
## Core Map
- `package.json` — Bun/Vite workspace for the UsagePal Tauri desktop app.
- `src/` — React UI for overview, provider detail, settings, dialogs, and tray-facing state.
- `src-tauri/` — Rust host for windowing, tray, plugin execution, local API, and config.
- `plugins/` — Provider probes and tests bundled into the desktop app at build time.
- `docs/` — User and maintainer docs for app behavior, proxying, local API, plugins, and providers.
## API Surfaces
- Local HTTP API — documented in `docs/local-http-api.md`, implemented under `src-tauri/src/local_http_api/`.
- Plugin host API — Rust bridge in `src-tauri/src/plugin_engine/host_api.rs`, schema docs in `docs/plugins/`.
- Tauri commands/events — app shell, settings, log-level, copy-log, and quit actions flow through `src-tauri/src/lib.rs` plus frontend hooks.
## Modules / Components
- `src/App.tsx` — top-level app orchestration for plugin data, settings bootstrap, probing, and tray updates.
- `src/pages/overview.tsx` — primary provider overview screen with no retirement banner in this fork.
- `src/pages/settings.tsx` plus `src/components/settings-app-menu.tsx` — app preferences, plugin toggles, shortcuts, and bottom App Menu actions.
- `src/components/` — reusable dialogs, cards, nav, footer, skeletons, and UI primitives.
- `src/lib/settings.ts` — persisted frontend settings and migration helpers.
- `src-tauri/src/plugin_engine/` — manifest loading, runtime sandboxing, and host capabilities for plugins.
## Infrastructure / Cross-Cutting
- `src-tauri/tauri.conf.json` — app metadata now branded as `UsagePal` with identifier `com.halloweed.usagepal`.
- `src-tauri/src/config.rs` — optional proxy config loaded from `~/.usagepal/config.json`.
- `src-tauri/src/log_path.rs` — log file naming for UsagePal app logs.
- `src-tauri/src/tray.rs` — menu bar icon opens the panel directly; no native tray context menu is attached.
- `plugins/test-helpers.js` and `src/**/*.test.*` — shared test scaffolding across frontend and plugin suites.
## Security Rails
- Proxy config is opt-in and parsed once at startup before request use.
- Plugin execution stays behind the Rust host API surface and bundled plugin manifest/runtime checks.
- Copilot keychain cache now uses the `UsagePal-copilot` service name in this fork.
## Phase Status
- Imported from OpenUsage `v0.6.28` source archive into this repo.
- Core app/product branding renamed to UsagePal across desktop metadata, UI copy, docs, and selected plugin identity strings.
- Upstream retirement banner removed from the overview UI for this fork.
- Removed changelog, GitHub links, Help button, aptabase analytics, and updater plugin — all OpenUsage holdovers unused in this fork.
- Menu bar icon left-click opens the app panel on Home; Settings bottom App Menu holds old tray actions.
- Frontend and Rust dependency bundles trimmed (aptabase, updater config, permissions).
## Fast Locate Cheats
- Rename-sensitive metadata — `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`.
- Provider plugin behavior — `plugins/<provider>/plugin.js` and matching `plugin.test.js`.
- Tray/menu-bar behavior — `src/lib/tray-tooltip.ts`, `src/hooks/app/use-tray-icon.ts`, `src-tauri/src/tray.rs`.
- Settings bootstrap/tests — `src/hooks/app/use-settings-bootstrap.ts`, `src/lib/settings.ts`, `src/App.test.tsx`.
## Update Log (Last 5)
- 2026-06-28 — Split Settings App Menu into a component with a modal Debug Level picker.
- 2026-06-28 — Added Settings bottom App Menu for Show Stats, Debug Level, Copy Log Path, About, and Quit.
- 2026-06-28 — Removed native tray context menu so menu bar left-click opens Home and updated About attribution.
- 2026-06-28 — Stripped changelog, Help button, GitHub links, aptabase analytics, and updater plugin (dead OpenUsage holdovers).
- 2026-06-28 — Bootstrapped overview after importing OpenUsage `v0.6.28` into this repo as UsagePal and removing the retirement banner.
