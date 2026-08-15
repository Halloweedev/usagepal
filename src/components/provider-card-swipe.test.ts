import { describe, expect, it } from "vitest"
import { resolveSwipeTarget } from "@/components/provider-card-swipe"

describe("resolveSwipeTarget", () => {
  const T = 40
  it("swiping left past threshold goes to next account", () => {
    expect(resolveSwipeTarget(-50, T, 0, 3)).toBe(1)
  })
  it("swiping right past threshold goes to previous account", () => {
    expect(resolveSwipeTarget(50, T, 1, 3)).toBe(0)
  })
  it("below threshold stays put", () => {
    expect(resolveSwipeTarget(-20, T, 1, 3)).toBe(1)
  })
  it("cannot page past the last account", () => {
    expect(resolveSwipeTarget(-100, T, 2, 3)).toBe(2)
  })
  it("cannot page before the first account", () => {
    expect(resolveSwipeTarget(100, T, 0, 3)).toBe(0)
  })
  it("single account never moves", () => {
    expect(resolveSwipeTarget(-999, T, 0, 1)).toBe(0)
  })
})
