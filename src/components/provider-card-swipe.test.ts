import { describe, expect, it } from "vitest"
import { resolveSwipeCommit, resolveSwipeTarget } from "@/components/provider-card-swipe"

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

describe("resolveSwipeCommit", () => {
  const T = 40
  const slow = 0.05 // px/ms, below flick
  const flick = 0.5 // px/ms, a fast flick

  it("commits a slow drag only past the distance threshold", () => {
    expect(resolveSwipeCommit(-50, slow, 0, 3, T)).toBe(1)
    expect(resolveSwipeCommit(-20, slow, 0, 3, T)).toBe(0)
  })

  it("a fast flick pages even below the distance threshold", () => {
    expect(resolveSwipeCommit(-20, flick, 0, 3, T)).toBe(1)
    expect(resolveSwipeCommit(20, flick, 1, 3, T)).toBe(0)
  })

  it("sub-slop jitter never pages, however fast", () => {
    expect(resolveSwipeCommit(-4, flick, 0, 3, T)).toBe(0)
  })

  it("a flick still cannot page past the ends", () => {
    expect(resolveSwipeCommit(-30, flick, 2, 3, T)).toBe(2)
    expect(resolveSwipeCommit(30, flick, 0, 3, T)).toBe(0)
  })
})
