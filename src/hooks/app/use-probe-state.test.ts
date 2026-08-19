import { describe, expect, it } from "vitest"
import { stateKey } from "@/hooks/app/use-probe-state"

describe("stateKey", () => {
  it("uses providerId alone for the default account", () => {
    expect(stateKey("claude", null)).toBe("claude")
    expect(stateKey("claude", undefined)).toBe("claude")
    expect(stateKey("claude", "")).toBe("claude")
  })

  it("is composite for a named account", () => {
    expect(stateKey("claude", "work")).toBe("claude::work")
  })
})
