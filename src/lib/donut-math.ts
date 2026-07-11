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
