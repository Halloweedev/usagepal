---
name: release-tauri
description: >-
  Cut a release of the Tauri edition of OpenUsage (main branch): version bump,
  generate a GitHub Release-style changelog, update CHANGELOG.md, and publish a
  GitHub Release. Use when the user asks to tag a Tauri release, bump the
  version, create a changelog, cut a release, or publish release notes. Pairs
  with release-swift (the native Swift edition on the swift branch).
---

# Release Tauri

Bump the project version, generate a categorized changelog with author attribution, tag the release, and publish to GitHub Releases. This skill cuts the Tauri edition only.

## Lane and scope

This skill cuts Tauri-edition releases only. Tauri stays on version lane `0.6.x`; never bump to `0.7.x` (Swift's lane). The Tauri edition is frozen - in practice the next release is the final "goodbye" build with the retirement banner. The native Swift edition has its own skill (release-swift) on the `swift` branch.

## Workflow

### 1. Determine New Version

- Read the current version from `package.json` and the latest **Tauri** tag: `git tag --list 'v0.6.*' --sort=-v:refname | head -1`. Do not use the repo-wide "latest tag" - it may now be a Swift `0.7.x` pre-release, which would skew the proposed version.
- Tauri is frozen on the `0.6.x` lane, so only **patch** bumps are allowed (e.g. `0.6.27` -> `0.6.28`). Do NOT do a minor or major bump: from `0.6.x` that produces `0.7.0`, which collides with Swift's lane and can hijack GitHub Latest. (Swift releases use the release-swift skill on the `swift` branch.)
- Show the proposed new version and **confirm with the user** before proceeding.

### 2. Generate Changelog

Collect commits since the previous Tauri tag (the latest `v0.6.*` tag from step 1, not the repo-wide latest tag, which may be a Swift `0.7.x` release) and build the changelog:

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

Check for and update **every** version file that exists in the repo:

- `package.json`
- `src-tauri/tauri.conf.json`
- `src-tauri/Cargo.toml` (must update if tauri.conf.json exists)
- `Cargo.toml` (root-level, Rust projects)
- `pyproject.toml`
- `pubspec.yaml`
- `build.gradle` / `build.gradle.kts`
- `Info.plist` (`CFBundleShortVersionString`)

After updating any `Cargo.toml`, run `cargo update -p {package_name}` to sync `Cargo.lock`.

Prepend the approved changelog to `CHANGELOG.md` immediately after the `# Changelog` header. Create the file with that header if it does not exist.

Commit **all** changes (version bumps + CHANGELOG.md) in a single commit:

```
chore: bump version to {new_version}
```

### 5. Create Git Tag

```bash
git tag -a v{new_version} -m "v{new_version}"
```

### 6. Push Commit + Tag

Ask the user before pushing. If confirmed, push the commit and tag **before** creating the GitHub Release — `gh release create` resolves the tag on the remote, so the version bump commit must already be there.

```bash
git push origin {branch}
git push origin v{new_version}
```

### 7. Verify and publish (mandatory - never leave a draft)

`publish.yml` runs `tauri-action` with `releaseDraft: false`, so a clean run publishes the release immediately. Drafts still slip through in practice: an interrupted, failed, or re-run matrix job (aarch64 + x86_64), or a manual `gh release create` racing CI, can leave an orphan draft for the tag. (This is how the repo ended up with stale drafts for v0.6.1 and v0.6.8.) So always finish a release by verifying it is actually published:

```bash
gh run watch
gh release view v{new_version} --json isDraft,isPrerelease,assets \
  --jq '{isDraft, isPrerelease, assets:[.assets[].name]}'
```

Require `isDraft=false`, `isPrerelease=false`, and assets including `latest.json` and a `.sig`. If it is still a draft with complete assets: `gh release edit v{new_version} --draft=false`.

Publish the approved changelog onto the release. `tauri-action` creates the release with a generic default body, so you must set the notes explicitly - otherwise you ship the exact blank-body release this skill exists to prevent. Write the step 2 changelog to a file and apply it:

```bash
gh release edit v{new_version} --notes-file <changelog-file>
```

If the workflow failed before `tauri-action` created the release, there is nothing to verify - re-run the workflow (`gh run rerun <run-id> --failed`) and wait. Do NOT create the release by hand with `gh release create`: a manual release ships without the signed `.dmg`, `.sig`, and `latest.json` updater assets and breaks auto-update for every Tauri user.

Before deleting any duplicate draft, reconcile it: compare its body and assets against the published release and migrate anything the published one is missing. (Release notes were lost this way for v0.6.1 and v0.6.8 - the published releases had blank bodies while the drafts held the changelog.) Migrate notes with `gh release edit v{new_version} --notes-file <file>`. Only then delete the duplicate draft. Guard the delete so it can NEVER remove the sole release for a tag - it only runs once a separate PUBLISHED (non-draft) release for that tag already exists:

```bash
tag="v{new_version}"
if [ "$(gh release view "$tag" --json isDraft --jq '.isDraft')" = "false" ]; then
  gh api repos/{owner}/{repo}/releases --paginate \
    --jq '.[] | select(.draft and .tag_name=="'"$tag"'") | .id' \
    | xargs -I{} gh api -X DELETE repos/{owner}/{repo}/releases/{}
else
  echo "No published release for $tag yet - publish it first; do NOT delete the draft."
fi
```

Definition of done: exactly one published, non-draft release for the tag, with updater assets AND the release notes present.

## Changelog Template

Only include category sections that have entries.

~~~markdown
## v{new_version}

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

**Full Changelog**: [{prev_tag}...v{new_version}](https://github.com/{owner}/{repo}/compare/{prev_tag}...v{new_version})

- [{short_hash}](https://github.com/{owner}/{repo}/commit/{full_hash}) {commit message} by @{author}
~~~

## Rules

- Commit hashes in output are 7 characters (short hash).
- Tags are always prefixed with `v` (e.g. `v0.1.1`).
- Never push automatically -- always ask the user first.
- Always publish release notes to GitHub Releases -- never skip this step.
- For commits without a PR number, omit the PR link but still include the author.
