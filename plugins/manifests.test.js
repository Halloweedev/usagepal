import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

// Validates every bundled plugin manifest the way the Rust loader
// (src-tauri/src/plugin_engine/manifest.rs) does, so a manifest that would silently fail to load at
// runtime — e.g. a missing `entry` field — fails here instead. Plugin unit tests import plugin.js
// directly and bypass the manifest, so they don't cover this.

const pluginsDir = dirname(fileURLToPath(import.meta.url))
const EXCLUDE = new Set(["mock"])

const pluginIds = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((d) => d.isDirectory() && !EXCLUDE.has(d.name))
  .map((d) => d.name)

describe("plugin manifests", () => {
  it("discovers plugin directories", () => {
    expect(pluginIds.length).toBeGreaterThan(0)
  })

  describe.each(pluginIds)("%s", (id) => {
    const dir = join(pluginsDir, id)
    const manifestPath = join(dir, "plugin.json")

    it("has a parseable plugin.json", () => {
      expect(existsSync(manifestPath)).toBe(true)
      expect(() => JSON.parse(readFileSync(manifestPath, "utf8"))).not.toThrow()
    })

    it("declares the required fields and a resolvable entry + icon", () => {
      const m = JSON.parse(readFileSync(manifestPath, "utf8"))

      expect(m.schemaVersion).toBe(1)
      expect(typeof m.id).toBe("string")
      expect(m.id.trim()).toBe(id) // directory name must match manifest id
      expect(typeof m.name).toBe("string")
      expect(m.name.trim().length).toBeGreaterThan(0)

      // `entry` is a required, non-empty, relative path to an existing file inside the plugin dir.
      expect(typeof m.entry).toBe("string")
      expect(m.entry.trim().length).toBeGreaterThan(0)
      expect(m.entry.startsWith("/")).toBe(false)
      expect(statSync(join(dir, m.entry)).isFile()).toBe(true)

      // `icon` must point at an existing file too.
      expect(typeof m.icon).toBe("string")
      expect(statSync(join(dir, m.icon)).isFile()).toBe(true)

      expect(Array.isArray(m.lines)).toBe(true)
    })
  })
})
