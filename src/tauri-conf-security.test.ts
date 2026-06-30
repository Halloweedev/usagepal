import { describe, expect, it } from "vitest"
import tauriConf from "../src-tauri/tauri.conf.json"

describe("tauri security config", () => {
  it("allows blob images so release builds can render dynamic tray icons", () => {
    const csp = tauriConf.app.security.csp

    expect(csp).toMatch(/img-src[^;]*\bblob:/)
  })
})
