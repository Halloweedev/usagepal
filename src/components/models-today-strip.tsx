import { useEffect, useMemo, useState } from "react"
import { ChartNoAxesGantt, ChartPie } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Donut } from "@/components/donut"
import { useDarkMode } from "@/hooks/use-dark-mode"
import { deriveModelColors } from "@/lib/graph-colors"
import { cn } from "@/lib/utils"
import {
  loadOverviewGraphStyle,
  saveOverviewGraphStyle,
  type OverviewGraphStyle,
} from "@/lib/settings"
import {
  buildModelUsage,
  formatShareCost,
  formatSharePercent,
  type TodayModelsSource,
  type TodayProviderEntry,
  type UsagePeriod,
} from "@/lib/today-models"

const PERIODS: { id: UsagePeriod; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "yesterday", label: "Yesterday" },
  { id: "thirtyDay", label: "30 Days" },
]

const DONUT_SIZE = 96
const DONUT_CENTER = DONUT_SIZE / 2
const DONUT_GAP = 2
// A slim ring reads cleaner at this size than a thick one.
const DONUT_RADIUS = 36
const DONUT_STROKE = 13

// Floor so a ~1% or smaller provider still paints a visible block in the bar view.
const MIN_BAR_SEGMENT_PX = 4

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
  return (
    <Donut
      size={DONUT_SIZE}
      radius={DONUT_RADIUS}
      stroke={DONUT_STROKE}
      gap={DONUT_GAP}
      testId="strip-donut"
      sliceTestId="strip-donut-segment"
      slices={providers.map((provider) => ({
        key: provider.id,
        share: provider.share,
        color: colors.get(provider.id) ?? "currentColor",
        wrap: (arc) => (
          <Tooltip>
            <TooltipTrigger render={arc} />
            <TooltipContent side="top">
              <ProviderTooltip provider={provider} />
            </TooltipContent>
          </Tooltip>
        ),
      }))}
    >
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
    </Donut>
  )
}

/** Compact models strip for the Overview page, grouped by provider, with a
 * Today / Yesterday / 30 Days period toggle and a bar/donut style toggle
 * (persisted). Per-model detail is one hover away. Hidden entirely when no
 * model usage was recorded in any window. */
export function ModelsTodayStrip({ plugins }: { plugins: TodayModelsSource[] }) {
  const isDark = useDarkMode()
  const theme = isDark ? ("dark" as const) : ("light" as const)
  const [style, setStyle] = useState<OverviewGraphStyle>("compact")
  const [period, setPeriod] = useState<UsagePeriod>("today")

  // Build all three windows so tabs know which have data; period is session
  // state (resets to Today each open), so no persistence here.
  const usages = useMemo(
    () => ({
      today: buildModelUsage(plugins, "today"),
      yesterday: buildModelUsage(plugins, "yesterday"),
      thirtyDay: buildModelUsage(plugins, "thirtyDay"),
    }),
    [plugins]
  )
  // A tab is offered only when its window has spend; fall back to the first that
  // does so the user never lands on an empty selected period.
  const firstAvailable = PERIODS.find((p) => usages[p.id].totalCost > 0)?.id
  const activePeriod = usages[period].totalCost > 0 ? period : firstAvailable ?? "today"
  const usage = usages[activePeriod]

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

  if (!firstAvailable) return null

  const toggleStyle = () => {
    const next: OverviewGraphStyle = style === "compact" ? "detailed" : "compact"
    setStyle(next)
    void saveOverviewGraphStyle(next)
  }

  return (
    <div data-testid="models-today-strip" className="mb-3 rounded-xl border p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Period" className="flex min-w-0 gap-0.5">
          {PERIODS.map((p) => {
            const available = usages[p.id].totalCost > 0
            const isActive = p.id === activePeriod
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={isActive}
                disabled={!available}
                onClick={() => setPeriod(p.id)}
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors",
                  isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  !available && "cursor-default opacity-35 hover:text-muted-foreground"
                )}
              >
                {p.label}
              </button>
            )
          })}
        </div>
        <button
          type="button"
          aria-label={style === "compact" ? "Show detailed view" : "Show compact view"}
          onClick={toggleStyle}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
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
                      style={{
                        width: `${provider.share * 100}%`,
                        minWidth: MIN_BAR_SEGMENT_PX,
                        backgroundColor: colors.get(provider.id),
                      }}
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
