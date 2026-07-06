import tauriConfig from "../../src-tauri/tauri.conf.json"
import { describe, expect, it } from "vitest"

describe("app icon assets", () => {
  it("bundles the macOS icns file as a runtime resource for native notifications", () => {
    expect(tauriConfig.bundle.resources).toContain("icons/icon.icns")
  })
})
