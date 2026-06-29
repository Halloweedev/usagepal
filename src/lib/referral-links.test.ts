import { afterEach, describe, expect, it } from "vitest"
import { REFERRAL_LINKS, getReferralUrl } from "@/lib/referral-links"

describe("getReferralUrl", () => {
  afterEach(() => {
    delete REFERRAL_LINKS["__test__"]
  })

  it("returns an https referral URL when configured", () => {
    REFERRAL_LINKS["__test__"] = "https://example.com/?ref=abc"
    expect(getReferralUrl("__test__")).toBe("https://example.com/?ref=abc")
  })

  it("returns an http referral URL when configured", () => {
    REFERRAL_LINKS["__test__"] = "http://example.com/ref"
    expect(getReferralUrl("__test__")).toBe("http://example.com/ref")
  })

  it("trims surrounding whitespace", () => {
    REFERRAL_LINKS["__test__"] = "  https://example.com/ref  "
    expect(getReferralUrl("__test__")).toBe("https://example.com/ref")
  })

  it("returns undefined for an unknown provider", () => {
    expect(getReferralUrl("does-not-exist")).toBeUndefined()
  })

  it("returns undefined for a blank value", () => {
    REFERRAL_LINKS["__test__"] = "   "
    expect(getReferralUrl("__test__")).toBeUndefined()
  })

  it("returns undefined for a non-http(s) value", () => {
    REFERRAL_LINKS["__test__"] = "javascript:alert(1)"
    expect(getReferralUrl("__test__")).toBeUndefined()
  })
})
