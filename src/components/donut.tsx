import { Fragment, type ReactElement, type ReactNode } from "react"
import { annularSectorPath, donutArcs } from "@/lib/donut-math"

const TWO_PI = Math.PI * 2

export type DonutSlice = {
  key: string
  /** Fraction of the whole, 0..1. */
  share: number
  color: string
  /** Optionally wrap the rendered arc (e.g. in a Tooltip). Receives the
   * `<path>` element so it can be used as a trigger. */
  wrap?: (arc: ReactElement) => ReactNode
}

/** Shared slim donut. Each slice is a filled ring segment (annular sector)
 * with small rounded corners — soft ends without the fat bead a round
 * `strokeLinecap` produces on short arcs — separated by a gap. The Overview
 * strip and the shareable graph card both render through this so they stay
 * visually identical; callers vary only size, slices and center content
 * (passed as SVG `children`). */
export function Donut({
  size,
  radius,
  stroke,
  gap = 0.8,
  minSlice = 5,
  cornerRadius = 4,
  slices,
  testId,
  sliceTestId,
  children,
}: {
  size: number
  radius: number
  stroke: number
  gap?: number
  /** Floor for each slice, in pathLength units (of 100), so a tiny share never
   * renders as an invisible hairline. */
  minSlice?: number
  cornerRadius?: number
  slices: DonutSlice[]
  testId?: string
  sliceTestId?: string
  children?: ReactNode
}) {
  const center = size / 2
  const innerRadius = radius - stroke / 2
  const outerRadius = radius + stroke / 2
  const arcs = donutArcs(
    slices.map((slice) => slice.share),
    gap,
    minSlice
  )
  // pathLength units → radians, starting at 12 o'clock (SVG's 0 is 3 o'clock).
  const toAngle = (units: number) => (units / 100) * TWO_PI - Math.PI / 2
  return (
    <svg
      data-testid={testId}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
    >
      {arcs.map((arc, index) => {
        const slice = slices[index]
        const d = annularSectorPath({
          cx: center,
          cy: center,
          innerRadius,
          outerRadius,
          startAngle: toAngle(arc.start),
          endAngle: toAngle(arc.start + arc.sweep),
          cornerRadius,
        })
        const path = <path data-testid={sliceTestId} d={d} fill={slice.color} />
        return <Fragment key={slice.key}>{slice.wrap ? slice.wrap(path) : path}</Fragment>
      })}
      {children}
    </svg>
  )
}
