---
name: release-tauri
description: >-
  Cut a beta release of the Tauri edition of UsagePal (beta branch): version
  bump, generate a GitHub Release-style changelog, update CHANGELOG.md, and tag
  for CI to publish. Use when the user asks to tag a release, bump the version,
  create a changelog, cut a release, or publish release notes.
---

# Release Tauri

Bump the project version, generate a categorized changelog with author attribution, tag the release, and let CI publish to GitHub Releases. This skill cuts the Tauri edition only.

## Lane and scope

- Tauri is on the `0.7.x` lane and releases are **beta pre-releases** (`v0.7.xx-beta.N`) cut on the `beta/` branch. There is no separate Swift edition lane anymore — the Swift rewrite was dropped, and Tauri/Rust is the shipping app (see AGENTS.md).
- **Stay on beta.** Do not tag a plain `v0.7.xx` stable unless the user explicitly asks to promote a beta to stable.

## Workflow

### 1. Determine New Version

- Read the current version from `package.json` and the latest tag: `git tag --list 'v0.7.*' --sort=-v:refname | head -1`.
- The next release is the next beta (`0.7.69-beta.6` → `0.7.69-beta.7`). Show the proposed `v0.7.xx-beta.N` and **confirm with the user** before proceeding.

### 2. Generate Changelog

Collect commits since the previous `v0.7.*` tag and build the changelog:

**Categorization rules:**

| Commit prefix | Category |
|---|---|
| `feat`, `feature`, or starts with "Add" | New Features |
| `fix` or starts with "Fix" | Bug Fixes |
| `refactor`, `enhance` | Refactor |
| `chore`, `style`, `docs`, `perf`, `test`, `ci`, `build` | Chores |
| Uncategorized | Bug Fixes |

**Author attribution (required on every entry):**

- Commits with a PR number (`(#123)`): `gh pr view {number} --json author -q '.author.login'`
- Commits without a PR number: `gh api /repos/{owner}/{repo}/commits/{full_hash} -q '.author.login'`
- If the API returns null, fall back to the git author name from `git log`.

**Output the changelog inside a markdown code block** using the template below so the user can review it.

### 3. User Approval

Wait for the user to explicitly approve the changelog before making any file changes. Accept edits if offered.

### 4. Update Version Files + CHANGELOG.md

- Run `bun run version:bump 0.7.xx-beta.N` — it updates `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `src-tauri/Cargo.lock` atomically (aborting if any file is off). CI hard-fails if these disagree with the tag.
- Prepend the approved changelog to `CHANGELOG.md` as a `## v0.7.xx-beta.N` section immediately after the `# Changelog` header. CI bakes this exact section into the release notes (`releaseBody`), so it must exist before tagging.
- Commit **all** changes (version bumps + CHANGELOG.md) in a single commit:

```
chore(release): v0.7.xx-beta.N
```

### 5. Create Git Tag

```bash
git tag -a v0.7.xx-beta.N -m "v0.7.xx-beta.N"
```

### 6. Push Commit + Tag

Ask the user before pushing. If confirmed, push the commit and tag — CI triggers on the tag push:

```bash
git push origin beta/v0.7.69
git push origin v0.7.69-beta.N
```

`publish.yml` validates the version files match the tag, builds signed arm64 + x86_64 DMGs, generates release notes from the CHANGELOG section, and publishes the release as a **pre-release** (the tag has a `-` suffix).

### 7. Verify (mandatory - never leave a draft)

`publish.yml` runs `tauri-action` with `releaseDraft: false`, so a clean run publishes the release immediately. Drafts still slip through in practice: an interrupted, failed, or re-run matrix job (aarch64 + x86_64), or a manual `gh release create` racing CI, can leave an orphan draft for the tag. Always finish a release by verifying it is actually published:

```bash
gh run watch
gh release view v0.7.xx-beta.N --json isDraft,isPrerelease,assets \
  --jq '{isDraft, isPrerelease, assets:[.assets[].name]}'
```

Require `isDraft=false`, `isPrerelease=true` (beta), and assets including `latest.json` and a `.sig`. If it is still a draft with complete assets: `gh release edit v0.7.xx-beta.N --draft=false`.

Release notes are set by CI from the CHANGELOG section, so there is nothing to write by hand — but confirm the published body is not blank (the fallback only fires when the CHANGELOG section is missing).

Confirm the beta updater feed picked up the new manifest: `gh release view beta-feed --json assets --jq '.assets[].name'` should include `latest_beta.json`.

Do NOT create the release by hand with `gh release create`: a manual release ships without the signed `.dmg`, `.sig`, and `latest.json` updater assets and breaks auto-update.

## Changelog Template

Only include category sections that have entries.

~~~markdown
## v0.7.xx-beta.N

### New Features
- {message} ([#{pr}](https://github.com/{owner}/{repo}/pull/{pr})) by @{author}

### Bug Fixes
- {message} ([#{pr}](https://github.com/{owner}/{repo}/pull/{pr})) by @{author}

### Refactor
- {message} ([#{pr}](https://github.com/{owner}/{repo}/pull/{pr})) by @{author}

### Chores
- {message} ([#{pr}](https://github.com/{owner}/{repo}/pull/{pr})) by @{author}

---

### Changelog

**Full Changelog**: [{prev_tag}...v0.7.xx-beta.N](https://github.com/{owner}/{repo}/compare/{prev_tag}...v0.7.69-beta.N)

- [{short_hash}](https://github.com/{owner}/{repo}/commit/{full_hash}) {commit message} by @{author}
~~~

## Rules

- Commit hashes in output are 7 characters (short hash).
- Tags are always prefixed with `v` (e.g. `v0.7.69-beta.6`).
- Never push automatically -- always ask the user first.
- Stay on beta: only tag `v0.7.xx-beta.N` unless the user explicitly asks to promote to stable.
- For commits without a PR number, omit the PR link but still include the author.
