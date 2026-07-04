# UsagePal — track all your AI coding subscriptions in one place

[![Secured by Keylight.dev](https://img.shields.io/badge/Secured%20by-Keylight.dev-6E56CF)](https://keylight.dev)

See your usage at a glance from your menu bar. No digging through dashboards.

![UsagePal Screenshot](screenshot.png)

> **UsagePal is an independent, open-source fork of [OpenUsage](https://github.com/robinebers/openusage) by Robin Ebers.**
> It is not affiliated with, endorsed by, or an official part of OpenUsage. "OpenUsage" is Robin Ebers' trademark; this fork uses its own name and branding.

## About this fork

UsagePal continues the project on the **Rust + Tauri** version, with the **same stack and the same UI**:

- **Frontend:** TypeScript + React, Tailwind, Vite
- **Backend:** Rust + Tauri v2
- **Plugins:** sandboxed JavaScript run in an embedded QuickJS engine

It stays **open source (MIT)** and is actively maintained. The goal is a fast, native menu-bar tracker that keeps the architecture and look of the original while moving independently.

## Download

[**Download the latest release**](https://github.com/Halloweedev/usagepal/releases/latest) (macOS, Apple Silicon & Intel)

The app auto-updates. Install once and you're set.

## What It Does

UsagePal lives in your menu bar and shows you how much of your AI coding subscriptions you've used. Progress bars, badges, and clear labels. No mental math required.

- **One glance.** All your AI tools, one panel.
- **Always up-to-date.** Refreshes automatically on a schedule you pick.
- **[Pace alerts](docs/notifications.md).** Optional notifications when a limit is on track to run out.
- **Global shortcut.** Toggle the panel from anywhere with a customizable keyboard shortcut.
- **Lightweight.** Opens instantly, stays out of your way.
- **Plugin-based.** New providers get added without updating the whole app.
- **[Local HTTP API](docs/local-http-api.md).** Other apps can read your usage data from `127.0.0.1:6736`.
- **[Proxy support](docs/proxy.md).** Route provider HTTP requests through a SOCKS5 or HTTP proxy.

## Supported Providers

- [**Amp**](docs/providers/amp.md) / free tier, bonus, credits
- [**Antigravity**](docs/providers/antigravity.md) / all models
- [**Claude**](docs/providers/claude.md) / session, weekly, extra usage, local token usage (ccusage)
- [**ClinePass**](docs/providers/cline-pass.md) / Session, weekly, monthly limits, balance, usage trend
- [**Codex**](docs/providers/codex.md) / session, weekly, reviews, credits
- [**Copilot**](docs/providers/copilot.md) / credits, extra usage, chat, completions
- [**Cursor**](docs/providers/cursor.md) / credits, total usage, auto usage, API usage, on-demand, CLI auth
- [**Factory / Droid**](docs/providers/factory.md) / standard, premium tokens
- [**Grok**](docs/providers/grok.md) / credits used, plan, pay-as-you-go cap
- [**JetBrains AI Assistant**](docs/providers/jetbrains-ai-assistant.md) / quota, remaining
- [**Kiro**](docs/providers/kiro.md) / credits, bonus credits, overages
- [**Kimi Code**](docs/providers/kimi.md) / session, weekly
- [**MiniMax**](docs/providers/minimax.md) / coding plan session
- [**OpenCode Go**](docs/providers/opencode-go.md) / 5h, weekly, monthly spend limits
- [**OpenRouter**](docs/providers/openrouter.md) / credits, balance, daily/weekly/monthly spend, key limit
- [**Devin**](docs/providers/devin.md) / weekly quota, extra usage
- [**Z.ai**](docs/providers/zai.md) / session, weekly, web searches

Community contributions welcome. Want a provider that's not listed? [Open an issue.](https://github.com/Halloweedev/usagepal/issues/new)

## Open Source, Community Driven

UsagePal is open source and grows through community contributions: new providers, bug fixes, and ideas. If something is missing or broken, the best way to get it fixed is to [open an issue](https://github.com/Halloweedev/usagepal/issues/new) or submit a PR.

Plugins are currently bundled; making them loadable so you can build and run your own is on the roadmap.

<a href="https://www.star-history.com/?repos=Halloweedev%2Fusagepal&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=Halloweedev/usagepal&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=Halloweedev/usagepal&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/chart?repos=Halloweedev/usagepal&type=date&legend=top-left" />
 </picture>
</a>

### How to Contribute

- **Add a provider.** Each one is just a plugin. See the [Plugin API](docs/plugins/api.md).
- **Fix a bug.** PRs welcome. Provide before/after screenshots.
- **Request a feature.** [Open an issue](https://github.com/Halloweedev/usagepal/issues/new) and make your case.

Keep it simple. No feature creep, test your changes.

## Credits

- Forked from [**OpenUsage**](https://github.com/robinebers/openusage) by [Robin Ebers](https://github.com/robinebers) — the original project this is built on (MIT).
- Inspired by [CodexBar](https://github.com/steipete/CodexBar) by [@steipete](https://github.com/steipete).

Maintained by [Nicolas Demanez](https://github.com/Halloweedev).

## License

[MIT](LICENSE) — the fork preserves the original OpenUsage copyright and adds its own. See [NOTICE](NOTICE).

## Privacy

UsagePal sends an anonymous usage signal to [Keylight](https://keylight.dev) at
most once per day to count active installs. It contains no personal data and is
not tied to your identity — only a randomly generated install id, the app and
SDK versions, and your platform (e.g. macOS). Licensing for supporters is also
handled by Keylight, with license keys verified offline on your device.

---

<details>
<summary><strong>Build from source</strong></summary>

> **Warning**: The `main` branch may not be stable. Use tagged versions for stable builds.

### Stack

- TypeScript + React + Vite + Tailwind (frontend)
- Rust + Tauri v2 (backend)
- QuickJS (`rquickjs`) for the plugin engine
- [lutin](https://github.com/Halloweedev/lutin) for macOS DMG packaging, signing, and notarization

```bash
bun install
bun run tauri dev      # run in development
bun run tauri build    # production build
```

</details>
