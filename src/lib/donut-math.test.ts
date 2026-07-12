import { describe, expect, it } from "vitest"
import { annularSectorPath, donutArcs, polarPoint } from "@/lib/donut-math"

describe("donutArcs", () => {
  it("lays strictly proportional arcs with uniform gaps that sum to 100", () => {
    const gap = 1.5
    const arcs = donutArcs([0.5, 0.3, 0.2], gap)

    // 3 gaps of 1.5 = 4.5 reserved; 95.5 split 50/30/20.
    expect(arcs.map((a) => a.sweep)).toEqual([47.75, 28.65, 19.1])
    expect(arcs.map((a) => a.start)).toEqual([0, 49.25, 79.4])
    // Last arc's end plus its trailing gap wraps to exactly 100.
    const last = arcs[2]
    expect(last.start + last.sweep + gap).toBeCloseTo(100)
  })

  it("keeps small shares proportional instead of inflating them", () => {
    const arcs = donutArcs([0.94, 0.03, 0.03], 1.5)
    // The two 3% shares stay equal and ~1/3 the size difference — no floor.
    expect(arcs[1].sweep).toBeCloseTo(arcs[2].sweep)
    expect(arcs[0].sweep / arcs[1].sweep).toBeCloseTo(0.94 / 0.03)
  })

  it("normalizes shares that don't sum to 1", () => {
    const arcs = donutArcs([0.6, 0.3], 1.5) // sum 0.9

    expect(arcs[0].sweep).toBeCloseTo(64.667)
    expect(arcs[1].sweep).toBeCloseTo(32.333)
  })

  it("never lets gaps swallow more than half the ring", () => {
    const arcs = donutArcs(Array(100).fill(0.01), 1.5) // 100 * 1.5 would be 150
    const spent = arcs.reduce((sum, a) => sum + a.sweep, 0)
    expect(spent).toBeCloseTo(50) // available floored at 50
  })

  it("floors a tiny slice to minSlice and takes the deficit from the big ones", () => {
    // gaps 3×3 = 9, available 91. floor = min(4, 91/3) = 4.
    const arcs = donutArcs([0.97, 0.02, 0.01], 3, 4)

    expect(arcs[1].sweep).toBeCloseTo(4) // 1.82 → floored
    expect(arcs[2].sweep).toBeCloseTo(4) // 0.91 → floored
    expect(arcs[0].sweep).toBeCloseTo(83) // 91 − 8 for the two floors
    // Sweeps still fill exactly `available`, so slices + gaps wrap to 100.
    expect(arcs.reduce((s, a) => s + a.sweep, 0)).toBeCloseTo(91)
  })

  it("shrinks the floor when too many slices to fit, staying feasible", () => {
    const arcs = donutArcs(Array(20).fill(0.05), 3, 4)
    // gaps capped at 50, available 50, floor = min(4, 50/20) = 2.5.
    arcs.forEach((a) => expect(a.sweep).toBeCloseTo(2.5))
    expect(arcs.reduce((s, a) => s + a.sweep, 0)).toBeCloseTo(50)
  })

  it("is pure proportional when minSlice is 0", () => {
    const arcs = donutArcs([0.94, 0.03, 0.03], 3, 0)
    expect(arcs[1].sweep).toBeCloseTo(arcs[2].sweep)
    expect(arcs[0].sweep / arcs[1].sweep).toBeCloseTo(0.94 / 0.03)
  })

  it("returns an empty array for no shares", () => {
    expect(donutArcs([], 1.5)).toEqual([])
  })
})

describe("polarPoint", () => {
  it("places points using screen coords (y down, clockwise)", () => {
    const [x0, y0] = polarPoint(50, 50, 10, 0)
    expect([x0, y0]).toEqual([60, 50]) // +x axis
    const [x1, y1] = polarPoint(50, 50, 10, Math.PI / 2)
    expect(x1).toBeCloseTo(50)
    expect(y1).toBeCloseTo(60) // +y (downward) at +90°
  })
})

describe("annularSectorPath", () => {
  const base = { cx: 50, cy: 50, innerRadius: 40, outerRadius: 60, startAngle: 0, endAngle: 1 }

  it("emits a closed ring-segment path with an outer and inner arc, no NaN", () => {
    const d = annularSectorPath({ ...base, cornerRadius: 3 })
    expect(d).toMatch(/^M /)
    expect(d.trimEnd()).toMatch(/Z$/)
    expect(d.match(/ A /g)).toHaveLength(2) // outer + inner arc
    expect(d).not.toMatch(/NaN/)
  })

  it("clamps the corner radius so a thin, short segment never goes degenerate", () => {
    // Radial thickness 4 and a sliver span: corner radius must shrink, not throw.
    const d = annularSectorPath({ ...base, innerRadius: 48, outerRadius: 52, endAngle: 0.02, cornerRadius: 6 })
    expect(d).not.toMatch(/NaN/)
    expect(d).toMatch(/^M /)
  })

  it("flags the large-arc bit once a segment sweeps past 180°", () => {
    const wide = annularSectorPath({ ...base, endAngle: Math.PI + 0.5, cornerRadius: 3 })
    // Outer arc carries the large-arc flag "1" before its sweep flag.
    expect(wide).toMatch(/A 60 60 0 1 1/)
  })
})
