import { beforeEach, describe, expect, it, vi } from "vitest"

const kl = vi.hoisted(() => ({
  activate: vi.fn(),
  validate: vi.fn(),
  hasEntitlement: vi.fn(),
}))

vi.mock("tauri-plugin-keylight-api", () => ({
  activate: kl.activate,
  validate: kl.validate,
  hasEntitlement: kl.hasEntitlement,
}))

import { SUPPORTER_ENTITLEMENT, useAppLicenseStore } from "@/stores/app-license-store"

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  useAppLicenseStore.setState({
    status: "unlicensed",
    entitlements: {},
    lastError: undefined,
    hasActivated: false,
  })
})

describe("app-license-store", () => {
  it("activate(valid key) trims input, sets active + supporter + hasActivated", async () => {
    kl.activate.mockResolvedValue(true)
    kl.validate.mockResolvedValue(true)
    kl.hasEntitlement.mockResolvedValue(true)

    await useAppLicenseStore.getState().activate("  KEY-123  ")

    expect(kl.activate).toHaveBeenCalledWith("KEY-123")
    const s = useAppLicenseStore.getState()
    expect(s.status).toBe("active")
    expect(s.entitlements[SUPPORTER_ENTITLEMENT]).toBe(true)
    expect(s.hasActivated).toBe(true)
  })

  it("activate(invalid key) sets error and leaves hasActivated false", async () => {
    kl.activate.mockResolvedValue(false)

    await useAppLicenseStore.getState().activate("BAD")

    const s = useAppLicenseStore.getState()
    expect(s.status).toBe("error")
    expect(s.lastError).toBeTruthy()
    expect(s.hasActivated).toBe(false)
  })

  it("activate() that throws sets a friendly error", async () => {
    kl.activate.mockRejectedValue(new Error("network"))

    await useAppLicenseStore.getState().activate("KEY")

    expect(useAppLicenseStore.getState().status).toBe("error")
    expect(useAppLicenseStore.getState().lastError).toBeTruthy()
  })

  it("refresh() with valid license but no supporter entitlement → active, supporter false", async () => {
    kl.validate.mockResolvedValue(true)
    kl.hasEntitlement.mockResolvedValue(false)

    await useAppLicenseStore.getState().refresh()

    const s = useAppLicenseStore.getState()
    expect(s.status).toBe("active")
    expect(s.entitlements[SUPPORTER_ENTITLEMENT]).toBe(false)
  })

  it("refresh() with invalid license → unlicensed, no entitlements", async () => {
    kl.validate.mockResolvedValue(false)

    await useAppLicenseStore.getState().refresh()

    const s = useAppLicenseStore.getState()
    expect(s.status).toBe("unlicensed")
    expect(s.entitlements[SUPPORTER_ENTITLEMENT]).toBeUndefined()
  })
})
