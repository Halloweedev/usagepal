/** Geometry for SVG donut charts drawn with `pathLength={100}` circles:
 * each segment is a dash of `visible` units starting at `start`, with `gap`
 * units shaved off for the separator and a 0.2-unit floor so tiny shares
 * stay visible. */
export type DonutSegment = {
  start: number
  length: number
  visible: number
}

export function donutSegments(shares: number[], gap: number): DonutSegment[] {
  let cursor = 0
  return shares.map((share) => {
    const start = cursor
    const length = share * 100
    cursor += length
    return { start, length, visible: Math.max(length - gap, 0.2) }
  })
}

/** pathLength units (of 100) that a round `strokeLinecap` reaches beyond each
 * end of a dash, for a circle stroked at `strokeWidth` on `radius`. The cap is
 * a semicircle of radius strokeWidth/2; its bulge along the centerline is
 * strokeWidth/2 user units, converted to pathLength via the circumference. */
export function roundCapPad(radius: number, strokeWidth: number): number {
  return (strokeWidth / 2 / (2 * Math.PI * radius)) * 100
}

/** SVG `strokeDasharray` dash length + `strokeDashoffset` for one segment,
 * compensated so a round linecap's bulge lands where a flat end would: the
 * dash shrinks by `pad` at each end and its start shifts in by `pad`, so
 * segments keep their `gap` and terminate in clean semicircles. Pass `pad = 0`
 * for flat (butt) caps. The dash floors at 0.1 so a share too small to survive
 * the padding still renders as a rounded dot. */
export function roundCapDash(
  segment: DonutSegment,
  gap: number,
  pad: number
): { dash: number; offset: number } {
  return {
    dash: Math.max(segment.visible - pad * 2, 0.1),
    offset: -(segment.start + gap / 2 + pad),
  }
}
