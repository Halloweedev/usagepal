import { Fragment, type ReactElement, type ReactNode } from "react"
import { annularSectorPath, donutArcs } from "@/lib/donut-math"

const TWO_PI = Math.PI * 2

/** Share-card donut size; center total font scales from this baseline. */
export const SHARE_DONUT_REFERENCE_SIZE = 132
export const SHARE_DONUT_CENTER_FONT_SIZE = 18

export function donutCenterTotalFontSize(donutSize: number): number {
  return Math.round((donutSize / SHARE_DONUT_REFERENCE_SIZE) * SHARE_DONUT_CENTER_FONT_SIZE)
}

export function DonutCenterTotal({
  donutSize,
  label,
  unit,
}: {
  donutSize: number
  label: string
  /** Optional muted unit line below the amount (e.g. Million, Per Million). */
  unit?: string
}) {
  const center = donutSize / 2
  const fontSize = donutCenterTotalFontSize(donutSize)
  if (!unit) {
    return (
      <text
        x={center}
        y={center}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontSize={fontSize}
        fontWeight={600}
      >
        {label}
      </text>
    )
  }
  const unitFontSize = Math.max(10, Math.round(fontSize * 0.55))
  const gap = 6
  const blockHeight = fontSize + gap + unitFontSize
  const amountCenterY = center - blockHeight / 2 + fontSize / 2
  const unitCenterY = center + blockHeight / 2 - unitFontSize / 2
  return (
    <>
      <text
        x={center}
        y={amountCenterY}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontSize={fontSize}
        fontWeight={600}
      >
        {label}
      </text>
      <text
        x={center}
        y={unitCenterY}
        textAnchor="middle"
        dominantBaseline="middle"
        fill="currentColor"
        fontSize={unitFontSize}
        fontWeight={400}
        opacity={0.55}
      >
        {unit}
      </text>
    </>
  )
}

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
  minSlice = 6,
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
