import { describe, expect, it } from "vitest"
import { donutSegments, roundCapDash, roundCapPad } from "@/lib/donut-math"

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

describe("roundCapPad", () => {
  it("converts half the stroke width into pathLength units via the circumference", () => {
    expect(roundCapPad(33, 20)).toBeCloseTo(4.8228, 3)
    expect(roundCapPad(45, 26)).toBeCloseTo(4.5977, 3)
  })
})

describe("roundCapDash", () => {
  it("shrinks the dash by the pad on each end and shifts the start in by the pad", () => {
    const [seg] = donutSegments([0.5], 0.8)

    expect(roundCapDash(seg, 0.8, 4)).toEqual({ dash: 41.2, offset: -4.4 })
  })

  it("reproduces flat-cap geometry when the pad is zero", () => {
    const [seg] = donutSegments([0.5], 0.8)

    expect(roundCapDash(seg, 0.8, 0)).toEqual({ dash: 49.2, offset: -0.4 })
  })

  it("floors a padded-away tiny segment to a rounded dot", () => {
    const [seg] = donutSegments([0.001], 0.8)

    expect(roundCapDash(seg, 0.8, 4).dash).toBe(0.1)
  })
})
