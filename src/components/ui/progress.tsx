import * as React from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
  indicatorColor?: string
  markerValue?: number
  markerTooltip?: React.ReactNode
  refreshing?: boolean
}

const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  ({ className, value = 0, indicatorColor, markerValue, markerTooltip, refreshing, ...props }, ref) => {
    const clamped = Math.min(100, Math.max(0, value))
    const clampedMarker =
      typeof markerValue === "number" && Number.isFinite(markerValue)
        ? Math.min(100, Math.max(0, markerValue))
        : null
    const showMarker = clampedMarker !== null && clamped > 0 && clamped < 100
    const indicatorStyle = indicatorColor
      ? { backgroundColor: indicatorColor }
      : undefined
    const markerTransform =
      clampedMarker === null
        ? undefined
        : clampedMarker <= 0
          ? "translateX(0)"
          : clampedMarker >= 100
            ? "translateX(-100%)"
            : "translateX(-50%)"
    const markerStyle = showMarker
      ? {
          left: `${clampedMarker}%`,
          transform: markerTransform,
        }
      : undefined

    return (
      <div
        ref={ref}
        role="progressbar"
        aria-valuenow={clamped}
        aria-valuemin={0}
        aria-valuemax={100}
        className={cn("relative h-3 w-full overflow-hidden rounded-full bg-muted dark:bg-[#353537]", className)}
        {...props}
      >
        <div
          className="h-full transition-all bg-primary"
          style={{ width: `${clamped}%`, ...indicatorStyle }}
        />
        {showMarker &&
          (markerTooltip != null ? (
            <Tooltip>
              <TooltipTrigger
                render={(triggerProps) => (
                  <div
                    {...triggerProps}
                    data-slot="progress-marker"
                    className="absolute top-0 bottom-0 w-1 z-10 cursor-help rounded-sm bg-muted-foreground ring-1 ring-background/50"
                    style={markerStyle}
                  />
                )}
              />
              <TooltipContent side="top" className="text-xs text-center">
                {markerTooltip}
              </TooltipContent>
            </Tooltip>
          ) : (
            <div
              data-slot="progress-marker"
              aria-hidden="true"
              className="absolute top-0 bottom-0 w-1 z-10 pointer-events-none rounded-sm bg-muted-foreground ring-1 ring-background/50"
              style={markerStyle}
            />
          ))}
        {refreshing && (
          <div
            data-slot="progress-refreshing"
            aria-hidden="true"
            className="absolute inset-0 overflow-hidden rounded-full"
          >
            <div className="h-full w-full animate-shimmer bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>
        )}
      </div>
    )
  }
)
Progress.displayName = "Progress"

export { Progress }
