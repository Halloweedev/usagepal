/** One ring segment in pathLength units (of 100): a `sweep`-long arc beginning
 * at `start`. */
export type DonutArc = {
  start: number
  sweep: number
}

/** Smallest arc any non-zero slice may render at (pathLength units of 100). */
export const MIN_VISIBLE_ARC = 1.5

/** Lays shares around the ring as proportional arcs separated by a uniform gap.
 * Sweeps + gaps always sum to exactly 100, so segments add up to the whole and
 * lay out without overlap. `minSlice` floors each arc (in pathLength units) so a
 * tiny share never renders as an invisible hairline; the extra length is taken
 * proportionally from the slices still above the floor, via water-filling, so
 * the total is preserved and nothing overflows its slot. Per-slice floors are
 * capped relative to each share so negligible slices cannot balloon to the same
 * size as dominant ones when many entries compete for the ring. Shares are
 * normalized, so they need not sum to 1. */
export function donutArcs(
  shares: number[],
  gap: number,
  minSlice = 0,
  /** Max visual boost for a slice vs its fair share (display-only). */
  maxFloorBoost = 8
): DonutArc[] {
  const count = shares.length
  if (count === 0) return []
  const total = shares.reduce((sum, share) => sum + Math.max(share, 0), 0) || 1
  // Never let the gaps swallow more than half the ring, however many segments.
  const totalGap = Math.min(count * gap, 50)
  const available = 100 - totalGap
  const norm = shares.map((share) => Math.max(share, 0) / total)
  // Shrink the requested floor as slice count grows so many tiny entries cannot
  // each claim a full default minimum.
  const countScale = count <= 1 ? 1 : Math.min(1, Math.sqrt(4 / count))
  const effectiveMinSlice = minSlice * countScale
  // Cap the floor so `count` slices always fit in `available`.
  const globalFloor = Math.min(effectiveMinSlice, available / count)
  // Hard lower bound so dust shares stay readable; still capped by globalFloor
  // and maxFloorBoost so a dominant slice cannot be dwarfed by equal minima.
  const absoluteMin =
    minSlice > 0 ? Math.max(MIN_VISIBLE_ARC, effectiveMinSlice * 0.5) : 0
  const floors = norm.map((share) => {
    if (share <= 0) return 0
    const proportional = share * available
    const relativeCap = proportional * maxFloorBoost
    return Math.min(globalFloor, Math.max(relativeCap, absoluteMin))
  })

  // Water-filling: hand each slice its proportional cut of `available`, but
  // never below its per-slice floor; the deficit comes proportionally out of
  // the slices still above the floor. Re-run because shrinking the big ones can
  // push a mid-size slice under the floor — bounded by `count` passes.
  const sweeps = new Array<number>(count).fill(0)
  const fixed = new Array<boolean>(count).fill(false)
  for (let pass = 0; pass < count; pass++) {
    const fixedSweep = sweeps.reduce((sum, sweep, i) => sum + (fixed[i] ? sweep : 0), 0)
    const freeShare = norm.reduce((sum, n, i) => sum + (fixed[i] ? 0 : n), 0) || 1
    const remaining = available - fixedSweep
    let changed = false
    for (let i = 0; i < count; i++) {
      if (fixed[i]) continue
      const proportional = (norm[i] / freeShare) * remaining
      if (proportional < floors[i]) {
        sweeps[i] = floors[i]
        fixed[i] = true
        changed = true
      } else {
        sweeps[i] = proportional
      }
    }
    if (!changed) break
  }

  const perGap = totalGap / count
  let cursor = 0
  return sweeps.map((sweep) => {
    const arc = { start: cursor, sweep }
    cursor += sweep + perGap
    return arc
  })
}

/** Point on a circle of `radius` around (cx, cy) at `angle` radians. Screen
 * coords (y down), so increasing angle sweeps clockwise. */
export function polarPoint(cx: number, cy: number, radius: number, angle: number): [number, number] {
  return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]
}

export type AnnularSector = {
  cx: number
  cy: number
  innerRadius: number
  outerRadius: number
  /** Radians, clockwise on screen; endAngle > startAngle. */
  startAngle: number
  endAngle: number
  /** Desired corner radius; clamped so it never exceeds the segment's own
   * radial thickness or arc length. */
  cornerRadius: number
}

/** SVG path `d` for a ring segment (annular sector) with rounded corners.
 * Rounding each of the four corners by a small radius keeps segment ends soft
 * without the fat bead a round `strokeLinecap` produces on short arcs. */
export function annularSectorPath({
  cx,
  cy,
  innerRadius: ri,
  outerRadius: ro,
  startAngle: a0,
  endAngle: a1,
  cornerRadius,
}: AnnularSector): string {
  const span = a1 - a0
  // Clamp: no more than half the radial thickness, nor half either arc.
  const cr = Math.max(0, Math.min(cornerRadius, (ro - ri) / 2, (ro * span) / 2, (ri * span) / 2))
  const dOut = cr / ro // angular inset on the outer arc
  const dIn = cr / ri // angular inset on the inner arc
  const p = (r: number, a: number) => polarPoint(cx, cy, r, a)

  const oStart = p(ro, a0 + dOut)
  const oEnd = p(ro, a1 - dOut)
  const rEndOuter = p(ro - cr, a1)
  const rEndInner = p(ri + cr, a1)
  const iEnd = p(ri, a1 - dIn)
  const iStart = p(ri, a0 + dIn)
  const rStartInner = p(ri + cr, a0)
  const rStartOuter = p(ro - cr, a0)
  const cOEnd = p(ro, a1) // sharp corners used as quadratic controls
  const cIEnd = p(ri, a1)
  const cIStart = p(ri, a0)
  const cOStart = p(ro, a0)

  const largeOuter = span - 2 * dOut > Math.PI ? 1 : 0
  const largeInner = span - 2 * dIn > Math.PI ? 1 : 0
  const n = (x: number) => Number(x.toFixed(3))
  const cmd = (letter: string, ...nums: number[]) => `${letter} ${nums.map(n).join(" ")}`

  return [
    cmd("M", ...oStart),
    cmd("A", ro, ro, 0, largeOuter, 1, ...oEnd), // outer arc, clockwise
    cmd("Q", ...cOEnd, ...rEndOuter), // round the outer-end corner
    cmd("L", ...rEndInner), // radial edge inward
    cmd("Q", ...cIEnd, ...iEnd), // round the inner-end corner
    cmd("A", ri, ri, 0, largeInner, 0, ...iStart), // inner arc, counter-clockwise
    cmd("Q", ...cIStart, ...rStartInner), // round the inner-start corner
    cmd("L", ...rStartOuter), // radial edge outward
    cmd("Q", ...cOStart, ...oStart), // round the outer-start corner
    "Z",
  ].join(" ")
}
