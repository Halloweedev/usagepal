#!/usr/bin/env bun
// Bump the app version in every file that must agree for a release, in one
// step, so a release can't ship with a half-updated version (the CI guard
// hard-fails when package.json / tauri.conf.json / Cargo.toml disagree with
// the tag).
//
// Usage:  bun run version:bump <new-version>
//   e.g.  bun run version:bump 0.7.62
//         bun run version:bump 0.8.0-beta.1
//
// The current version is read from package.json, then replaced in:
//   - package.json                (top-level "version")
//   - src-tauri/tauri.conf.json   ("version")
//   - src-tauri/Cargo.toml        ([package] version)
//   - src-tauri/Cargo.lock        (the `usagepal` package entry)
//
// It validates every file has exactly the marker it expects BEFORE writing
// anything, so a rename/reformat that would leave a file behind aborts the
// whole run instead of producing a partial bump.

import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

const next = process.argv[2]
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/
if (!next || !SEMVER.test(next)) {
  console.error(`Usage: bun run version:bump <version>   (got: ${next ?? "nothing"})`)
  console.error("Version must look like 1.2.3 or 1.2.3-beta.4")
  process.exit(1)
}

const current = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version
if (current === next) {
  console.error(`Already at ${current}; nothing to do.`)
  process.exit(1)
}

// Each file's marker is the CURRENT version in the exact surrounding syntax,
// so we never touch a dependency version that happens to match.
const edits = [
  { file: "package.json", find: `"version": "${current}"`, replace: `"version": "${next}"` },
  { file: "src-tauri/tauri.conf.json", find: `"version": "${current}"`, replace: `"version": "${next}"` },
  { file: "src-tauri/Cargo.toml", find: `version = "${current}"`, replace: `version = "${next}"` },
  {
    file: "src-tauri/Cargo.lock",
    find: `name = "usagepal"\nversion = "${current}"`,
    replace: `name = "usagepal"\nversion = "${next}"`,
  },
]

// Pass 1: verify each file has exactly one occurrence of its marker. Abort the
// whole bump (writing nothing) if any file is off, so we never half-apply.
for (const { file, find } of edits) {
  const text = readFileSync(join(root, file), "utf8")
  const count = text.split(find).length - 1
  if (count !== 1) {
    console.error(`✗ ${file}: expected exactly 1 occurrence of \`${find.split("\n").join(" ")}\`, found ${count}. Aborting — no files changed.`)
    process.exit(1)
  }
}

// Pass 2: write.
for (const { file, find, replace } of edits) {
  const path = join(root, file)
  writeFileSync(path, readFileSync(path, "utf8").replace(find, replace))
  console.log(`✓ ${file}: ${current} → ${next}`)
}

console.log(`\nBumped ${current} → ${next}. Next: update CHANGELOG.md, commit, then tag v${next} and push.`)
