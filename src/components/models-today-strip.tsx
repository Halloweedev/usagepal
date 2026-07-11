import { useEffect, useMemo, useState } from "react"
import { ChartNoAxesGantt, ChartPie } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useDarkMode } from "@/hooks/use-dark-mode"
import { donutSegments, roundCapDash, roundCapPad } from "@/lib/donut-math"
import { deriveModelColors } from "@/lib/graph-colors"
import {
  loadOverviewGraphStyle,
  saveOverviewGraphStyle,
  type OverviewGraphStyle,
} from "@/lib/settings"
import {
  buildTodayModelUsage,
  formatShareCost,
  formatSharePercent,
  type TodayModelsSource,
  type TodayProviderEntry,
} from "@/lib/today-models"

const DONUT_SIZE = 96
const DONUT_CENTER = DONUT_SIZE / 2
const DONUT_GAP = 0.8
const DONUT_RADIUS = 33
const DONUT_STROKE = 20
const DONUT_CAP_PAD = roundCapPad(DONUT_RADIUS, DONUT_STROKE)

function ProviderTooltip({ provider }: { provider: TodayProviderEntry }) {
  return (
    <div className="flex min-w-40 flex-col gap-1 text-xs">
      <span className="flex justify-between gap-4 font-semibold">
        <span>{provider.name}</span>
        <span className="tabular-nums">{formatShareCost(provider.todayCost)}</span>
      </span>
      <div className="border-t" />
      {provider.models.map((model) => (
        <span key={model.name} className="flex justify-between gap-4 text-muted-foreground">
          <span className="truncate">{model.name}</span>
          <span className="shrink-0 tabular-nums">
            {formatSharePercent(model.todayCost / provider.todayCost)}{" "}
            <span className="text-foreground">{formatShareCost(model.todayCost)}</span>
          </span>
        </span>
      ))}
    </div>
  )
}

function StripDonut({
  providers,
  colors,
  totalLabel,
}: {
  providers: TodayProviderEntry[]
  colors: Map<string, string>
  totalLabel: string
}) {
  const segments = donutSegments(
    providers.map((provider) => provider.share),
    DONUT_GAP
  )
  return (
    <svg
      data-testid="strip-donut"
      width={DONUT_SIZE}
      height={DONUT_SIZE}
      viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
      className="shrink-0"
    >
      {segments.map((segment, index) => {
        const provider = providers[index]
        const { dash, offset } = roundCapDash(segment, DONUT_GAP, DONUT_CAP_PAD)
        return (
          <Tooltip key={provider.id}>
            <TooltipTrigger
              render={
                <circle
                  data-testid="strip-donut-segment"
                  cx={DONUT_CENTER}
                  cy={DONUT_CENTER}
                  r={DONUT_RADIUS}
                  fill="none"
                  strokeWidth={DONUT_STROKE}
                  strokeLinecap="round"
                  pathLength={100}
                  stroke={colors.get(provider.id)}
                  strokeDasharray={`${dash} ${100 - dash}`}
                  strokeDashoffset={offset}
                  // Start segments at 12 o'clock instead of SVG's 3 o'clock default.
                  transform={`rotate(-90 ${DONUT_CENTER} ${DONUT_CENTER})`}
                />
              }
            />
            <TooltipContent side="top">
              <ProviderTooltip provider={provider} />
            </TooltipContent>
          </Tooltip>
        )
      })}
      <text
        x={DONUT_CENTER}
        y={DONUT_CENTER + 5}
        textAnchor="middle"
        fill="currentColor"
        fontSize={14}
        fontWeight={600}
      >
        {totalLabel}
      </text>
    </svg>
  )
}

/** Compact "Models today" strip for the Overview page, grouped by provider:
 * bar or donut (user choice, persisted), per-model detail one hover away.
 * Hidden entirely when no model usage was recorded today. */
export function ModelsTodayStrip({ plugins }: { plugins: TodayModelsSource[] }) {
  const isDark = useDarkMode()
  const usage = useMemo(() => buildTodayModelUsage(plugins), [plugins])
  const theme = isDark ? ("dark" as const) : ("light" as const)
  const [style, setStyle] = useState<OverviewGraphStyle>("compact")

  useEffect(() => {
    let active = true
    void loadOverviewGraphStyle().then((stored) => {
      if (active) setStyle(stored)
    })
    return () => {
      active = false
    }
  }, [])

  const colors = useMemo(() => {
    const map = new Map<string, string>()
    for (const provider of usage.providers) {
      map.set(provider.id, deriveModelColors(provider.brandColor, 1, theme)[0])
    }
    return map
  }, [usage, theme])

  if (usage.totalCost <= 0) return null

  const toggleStyle = () => {
    const next: OverviewGraphStyle = style === "compact" ? "detailed" : "compact"
    setStyle(next)
    void saveOverviewGraphStyle(next)
  }

  return (
    <div data-testid="models-today-strip" className="mb-3 rounded-xl border p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold">Models today</span>
        <button
          type="button"
          aria-label={style === "compact" ? "Show detailed view" : "Show compact view"}
          onClick={toggleStyle}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          {style === "compact" ? <ChartPie className="size-3.5" /> : <ChartNoAxesGantt className="size-3.5" />}
        </button>
      </div>
      {style === "compact" ? (
        <>
          <div data-testid="strip-bar" className="flex h-2 gap-[2px] overflow-hidden rounded-full">
            {usage.providers.map((provider) => (
              <Tooltip key={provider.id}>
                <TooltipTrigger
                  render={
                    <div
                      data-testid="strip-segment"
                      className="h-full transition-[filter] hover:brightness-125 first:rounded-l-full last:rounded-r-full"
                      style={{ width: `${provider.share * 100}%`, backgroundColor: colors.get(provider.id) }}
                    />
                  }
                />
                <TooltipContent side="top">
                  <ProviderTooltip provider={provider} />
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1">
            {usage.providers.map((provider) => (
              <Tooltip key={provider.id}>
                <TooltipTrigger
                  render={
                    <span
                      data-testid="strip-legend-chip"
                      className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                    >
                      <span className="size-[7px] rounded-[2px]" style={{ backgroundColor: colors.get(provider.id) }} />
                      {provider.name} {formatSharePercent(provider.share)}
                    </span>
                  }
                />
                <TooltipContent side="top">
                  <ProviderTooltip provider={provider} />
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </>
      ) : (
        <div className="flex items-center gap-4">
          <StripDonut providers={usage.providers} colors={colors} totalLabel={formatShareCost(usage.totalCost)} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {usage.providers.map((provider) => (
              <Tooltip key={provider.id}>
                <TooltipTrigger
                  render={
                    <div data-testid="strip-provider-row" className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <span
                          className="size-[7px] shrink-0 rounded-[2px]"
                          style={{ backgroundColor: colors.get(provider.id) }}
                        />
                        <span className="truncate">{provider.name}</span>
                      </span>
                      <span className="tabular-nums">{formatShareCost(provider.todayCost)}</span>
                    </div>
                  }
                />
                <TooltipContent side="top">
                  <ProviderTooltip provider={provider} />
                </TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
