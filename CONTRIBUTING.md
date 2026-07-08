# Contributing to UsagePal

UsagePal accepts contributions, but has a high quality bar. Read this entire document before opening a PR.

## Philosophy

UsagePal is highly opinionated. It focuses on clean design, fast performance, and a great user experience. The feature set is intentionally limited to core functionality: tracking AI coding subscription usage, nothing more. Contributions that try to expand that scope, add unnecessary complexity, or compromise the UX will be closed.

If you're unsure whether your idea fits, open an issue first.

## Ground Rules

- No feature creep. If it's not about usage tracking, it doesn't belong here.
- No AI-generated commit messages. Write your own.
- Test your changes. If it touches UI, include before/after screenshots.
- Keep it simple. Don't over-engineer.
- One PR per concern. Don't bundle unrelated changes.
- Match the existing design language. UsagePal has a specific look and feel.

## License Agreement

By submitting a pull request, you agree that your contribution is licensed under the [MIT License](LICENSE) that covers this project.

## How to Contribute

### Fork and PR workflow

1. Fork the repo
2. Create a branch (`feat/my-change`, `fix/some-bug`, etc.)
3. Make your changes
4. Run `bun run build` and `bun run test` to verify nothing is broken
5. Open a PR against `main`

### Add a provider plugin

Each provider is a plugin. See the [Plugin API docs](docs/plugins/api.md) for the full spec.

1. Create a new folder under `plugins/` with your provider name
2. Add `plugin.json` (metadata) and `plugin.js` (implementation)
3. Add documentation in `docs/providers/`
4. Test it locally with `bun tauri dev`
5. Open a PR with screenshots showing it working

You can also [open an issue](https://github.com/halloweedev/usagepal/issues/new?template=new_provider.yml) to request a provider without building it yourself.

### Fix a bug

1. Reference the issue number in your PR
2. Describe the root cause and fix
3. Include before/after screenshots for UI bugs
4. Add a regression test if applicable

### Request a feature

Don't open a PR for large features without discussing first. [Open an issue](https://github.com/halloweedev/usagepal/issues/new?template=feature_request.yml) and make your case.

## What Gets Accepted

- Bug fixes with clear descriptions
- New provider plugins that follow the Plugin API
- Documentation improvements
- Performance improvements with benchmarks
- Accessibility improvements

## What Gets Rejected

- Features that expand the scope beyond usage tracking
- Changes that compromise speed, simplicity, or the existing UX
- PRs without testing evidence
- Code with no clear purpose or explanation
- Cosmetic-only changes without prior discussion

## Code Standards

- TypeScript for frontend (`src/`)
- Rust for backend (`src-tauri/`)
- Follow existing patterns in the codebase
- No new dependencies without justification

## Maintainers

- [@halloweedev](https://github.com/halloweedev) (lead)

All PRs require approval from at least 1 maintainer before merging.
Release tags (`v*`) are owner-managed and can only be created by [@halloweedev](https://github.com/halloweedev).

### Releases and betas

- **Stable:** tag `vX.Y.Z` (e.g. `v0.7.26`) with the three version files (`package.json`,
  `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`) set to `X.Y.Z`. Publishes as GitHub "Latest"
  and auto-updates everyone via `releases/latest/download/latest.json`.
- **Beta / dev:** tag `vX.Y.Z-beta.N` (or `-rc.N`) with the version files set to the matching
  `X.Y.Z-beta.N`. The publish workflow marks any tag containing `-` as a GitHub **pre-release**, so it
  never becomes "Latest" and the stable auto-updater never serves it. Testers install the beta DMG from
  the pre-release's assets by hand. Auto-updating betas (an Early Access channel) is not wired up yet.

## Questions?

Open a [bug report](https://github.com/halloweedev/usagepal/issues/new?template=bug_report.yml) or [feature request](https://github.com/halloweedev/usagepal/issues/new?template=feature_request.yml) using the issue templates.
