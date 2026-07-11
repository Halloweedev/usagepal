import { describe, expect, it } from "vitest"
import { donutSegments } from "@/lib/donut-math"

describe("donutSegments", () => {
  it("lays segments end to end over 100 pathLength units", () => {
    const segments = donutSegments([0.5, 0.3, 0.2], 0.8)

    expect(segments.map((s) => s.start)).toEqual([0, 50, 80])
    expect(segments.map((s) => s.length)).toEqual([50, 30, 20])
    expect(segments.map((s) => s.visible)).toEqual([49.2, 29.2, 19.2])
  })

  it("floors tiny segments at 0.2 visible units", () => {
    const segments = donutSegments([0.005, 0.995], 0.8)

    expect(segments[0].visible).toBe(0.2)
    expect(segments[1].start).toBeCloseTo(0.5)
  })

  it("returns an empty array for no shares", () => {
    expect(donutSegments([], 0.8)).toEqual([])
  })
})
