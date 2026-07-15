import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const isTauriMock = vi.fn()
const enableMock = vi.fn()
const disableMock = vi.fn()
const isEnabledMock = vi.fn()

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => isTauriMock(),
}))
vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: () => enableMock(),
  disable: () => disableMock(),
  isEnabled: () => isEnabledMock(),
}))

import { syncAutostart } from "./autostart"

describe("syncAutostart", () => {
  beforeEach(() => {
    isTauriMock.mockReset().mockReturnValue(true)
    enableMock.mockReset().mockResolvedValue(undefined)
    disableMock.mockReset().mockResolvedValue(undefined)
    isEnabledMock.mockReset().mockResolvedValue(false)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("no-ops outside Tauri", async () => {
    vi.stubEnv("DEV", false)
    isTauriMock.mockReturnValue(false)
    await syncAutostart(true)
    expect(isEnabledMock).not.toHaveBeenCalled()
    expect(enableMock).not.toHaveBeenCalled()
  })

  it("never touches the OS from a dev build (would register the ephemeral dev binary)", async () => {
    vi.stubEnv("DEV", true)
    await syncAutostart(true)
    expect(isEnabledMock).not.toHaveBeenCalled()
    expect(enableMock).not.toHaveBeenCalled()
    expect(disableMock).not.toHaveBeenCalled()
  })

  it("enables when on and the OS is not yet registered (release build)", async () => {
    vi.stubEnv("DEV", false)
    isEnabledMock.mockResolvedValue(false)
    await syncAutostart(true)
    expect(enableMock).toHaveBeenCalledTimes(1)
    expect(disableMock).not.toHaveBeenCalled()
  })

  it("skips the native call when the OS already matches", async () => {
    vi.stubEnv("DEV", false)
    isEnabledMock.mockResolvedValue(true)
    await syncAutostart(true)
    expect(enableMock).not.toHaveBeenCalled()
    expect(disableMock).not.toHaveBeenCalled()
  })

  it("disables when off and the OS is currently registered", async () => {
    vi.stubEnv("DEV", false)
    isEnabledMock.mockResolvedValue(true)
    await syncAutostart(false)
    expect(disableMock).toHaveBeenCalledTimes(1)
    expect(enableMock).not.toHaveBeenCalled()
  })
})
