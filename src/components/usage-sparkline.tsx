import { useState, type CSSProperties } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn, clamp01, formatCountNumber } from "@/lib/utils"
import type { BarChartPoint } from "@/lib/plugin-types"

type UsageSparklineProps = {
  label: string
  points: BarChartPoint[]
  note?: string
  color?: string
}

const pointLabel = (point: BarChartPoint) => point.valueLabel ?? formatCountNumber(point.value)

// Inline, glanceable usage history that matches the card's row rhythm.
// Hover/focus reveals a larger, readable graph (detail-on-demand); hovering a
// day's bar in that graph shows exactly how much was used that day.
export function UsageSparkline({ label, points, note, color }: UsageSparklineProps) {
  const valid = points.filter((point) => Number.isFinite(point.value) && point.value >= 0)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  if (valid.length === 0) return null

  const maxValue = Math.max(1, ...valid.map((point) => point.value))
  const peak = valid.reduce((a, b) => (b.value > a.value ? b : a))
  const last = valid[valid.length - 1]
  const summary = `${label}: ${valid.length} days, latest ${pointLabel(last)} on ${last.label}, peak ${pointLabel(peak)}.${note ? ` ${note}` : ""}`

  // Default readout = peak; hovering a bar shows that specific day.
  const active = activeIndex != null ? valid[activeIndex] : null
  const readout = active ? `${active.label} · ${pointLabel(active)}` : `peak ${pointLabel(peak)}`

  const barStyle = (point: BarChartPoint, minPercent: number): CSSProperties => {
    const ratio = clamp01(point.value / maxValue)
    const height = point.value > 0 ? Math.max(minPercent, ratio * 100) : minPercent / 2
    const style: CSSProperties = { height: `${height}%` }
    if (color) style.backgroundColor = color
    return style
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            aria-label={summary}
            className="flex h-[18px] w-full items-center justify-between gap-2 rounded-sm border-0 bg-transparent p-0 text-left outline-none [touch-action:manipulation] focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="min-w-0 truncate text-xs text-muted-foreground">{label}</span>
            <span
              aria-hidden
              className="flex h-4 w-1/2 max-w-[150px] flex-shrink-0 items-end justify-end gap-px"
            >
              {valid.map((point, index) => (
                <span
                  key={`${point.label}-${index}`}
                  className="min-w-[2px] flex-1 rounded-[1px] bg-primary"
                  style={barStyle(point, 10)}
                />
              ))}
            </span>
          </button>
        )}
      />
      <TooltipContent side="top" className="w-56" onMouseLeave={() => setActiveIndex(null)}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs font-medium">{label}</span>
          <span className="text-[10px] tabular-nums text-muted-foreground">{readout}</span>
        </div>
        <div className="mt-1.5 flex h-20 items-end gap-px">
          {valid.map((point, index) => (
            // Full-height column is the hover/focus target so even short bars
            // are easy to hit with a pointer or keyboard.
            <button
              key={`${point.label}-${index}`}
              type="button"
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onBlur={() => setActiveIndex(null)}
              title={`${point.label}: ${pointLabel(point)}`}
              aria-label={`${point.label}: ${pointLabel(point)}`}
              className="flex h-full min-w-[3px] flex-1 items-end border-0 bg-transparent p-0 outline-none [touch-action:manipulation] focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span
                className={cn(
                  "w-full rounded-[1px] bg-primary transition-opacity",
                  activeIndex != null && index !== activeIndex && "opacity-40"
                )}
                style={barStyle(point, 6)}
              />
            </button>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted-foreground">
          <span>{valid[0].label}</span>
          <span>{last.label}</span>
        </div>
        {note && <div className="mt-1 text-[10px] text-muted-foreground">{note}</div>}
      </TooltipContent>
    </Tooltip>
  )
}
