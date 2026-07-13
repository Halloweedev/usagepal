import { useEffect, useMemo, useState } from "react"
import { ChartNoAxesGantt, ChartPie, LayoutGrid, ListTree } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Donut, DonutCenterTotal } from "@/components/donut"
import { useDarkMode } from "@/hooks/use-dark-mode"
import { assignGraphEntryColors } from "@/lib/graph-colors"
import { cn } from "@/lib/utils"
import {
  loadOverviewGraphGroupBy,
  loadOverviewGraphStyle,
  saveOverviewGraphGroupBy,
  saveOverviewGraphStyle,
  type OverviewGraphGroupBy,
  type OverviewGraphStyle,
} from "@/lib/settings"
import {
  buildModelUsage,
  formatShareCost,
  formatShareDonutTotal,
  formatSharePercent,
  modelEntryKey,
  type TodayModelEntry,
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
const DONUT_GAP = 0.8
const DONUT_RADIUS = 36
const DONUT_STROKE = 13

const MIN_BAR_SEGMENT_PX = 5

type StripEntry = {
  key: string
  label: string
  share: number
  cost: number
  brandColor: string | null
  isOthers?: boolean
  tooltip: React.ReactNode
}

function ModelTooltip({ model }: { model: TodayModelEntry }) {
  const providers =
    model.providerNames.length > 0 ? model.providerNames : model.providerName ? [model.providerName] : []
  return (
    <div className="flex min-w-40 flex-col gap-1 text-xs">
      <span className="flex justify-between gap-4 font-semibold">
        <span>{model.name}</span>
        <span className="tabular-nums">{formatShareCost(model.todayCost)}</span>
      </span>
      {!model.isOthers && providers.length > 0 && (
        <span className="text-muted-foreground">{providers.join(" · ")}</span>
      )}
    </div>
  )
}

function ProviderTooltip({ provider }: { provider: TodayProviderEntry }) {
  return (
    <div className="flex min-w-40 flex-col gap-1 text-xs">
      <span className="flex justify-between gap-4 font-semibold">
        <span>{provider.name}</span>
        <span className="tabular-nums">{formatShareCost(provider.todayCost)}</span>
      </span>
      <div className="border-t" />
      {provider.models.map((model) => (
        <span key={modelEntryKey(model)} className="flex justify-between gap-4 text-muted-foreground">
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

function StripLegendBar({
  entries,
  colors,
}: {
  entries: StripEntry[]
  colors: Map<string, string>
}) {
  const splitIndex = Math.ceil(entries.length / 2)
  const columns = [entries.slice(0, splitIndex), entries.slice(splitIndex)]

  return (
    <div data-testid="strip-legend" className="mt-2.5 grid grid-cols-2 gap-x-4">
      {columns.map((columnEntries, columnIndex) => (
        <div key={columnIndex} className="flex min-w-0 flex-col gap-1">
          {columnEntries.map((entry) => (
            <Tooltip key={entry.key}>
              <TooltipTrigger
                render={
                  <div
                    data-testid="strip-legend-chip"
                    className="grid grid-cols-[auto_minmax(0,1fr)_2.25rem] items-center gap-x-1.5 text-[11px] text-muted-foreground"
                  >
                    <span
                      className="size-[7px] rounded-[2px]"
                      style={{ backgroundColor: colors.get(entry.key) }}
                    />
                    <span className="truncate">{entry.label}</span>
                    <span className="tabular-nums text-right">{formatSharePercent(entry.share)}</span>
                  </div>
                }
              />
              <TooltipContent side="top">{entry.tooltip}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      ))}
    </div>
  )
}

function StripDonut({
  entries,
  colors,
  totalLabel,
}: {
  entries: StripEntry[]
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
      slices={entries.map((entry) => ({
        key: entry.key,
        share: entry.share,
        color: colors.get(entry.key) ?? "currentColor",
        wrap: (arc) => (
          <Tooltip>
            <TooltipTrigger render={arc} />
            <TooltipContent side="top">{entry.tooltip}</TooltipContent>
          </Tooltip>
        ),
      }))}
    >
      <DonutCenterTotal donutSize={DONUT_SIZE} label={totalLabel} />
    </Donut>
  )
}

function buildStripEntries(
  usage: ReturnType<typeof buildModelUsage>,
  groupBy: OverviewGraphGroupBy
): StripEntry[] {
  if (groupBy === "provider") {
    return usage.providers.map((provider) => ({
      key: provider.id,
      label: provider.name,
      share: provider.share,
      cost: provider.todayCost,
      brandColor: provider.brandColor,
      tooltip: <ProviderTooltip provider={provider} />,
    }))
  }
  return usage.models.map((model) => ({
    key: modelEntryKey(model),
    label: model.name,
    share: model.share,
    cost: model.todayCost,
    brandColor: model.brandColor,
    isOthers: model.isOthers,
    tooltip: <ModelTooltip model={model} />,
  }))
}

/** Models strip for the Overview page with period, bar/donut, and
 * model/provider grouping toggles (all persisted). Hidden when no usage was
 * recorded in any window. */
export function ModelsTodayStrip({ plugins }: { plugins: TodayModelsSource[] }) {
  const isDark = useDarkMode()
  const theme = isDark ? ("dark" as const) : ("light" as const)
  const [graphStyle, setGraphStyle] = useState<OverviewGraphStyle>("donut")
  const [groupBy, setGroupBy] = useState<OverviewGraphGroupBy>("provider")
  const [period, setPeriod] = useState<UsagePeriod>("today")

  const usages = useMemo(
    () => ({
      today: buildModelUsage(plugins, "today"),
      yesterday: buildModelUsage(plugins, "yesterday"),
      thirtyDay: buildModelUsage(plugins, "thirtyDay"),
    }),
    [plugins]
  )
  const firstAvailable = PERIODS.find((p) => usages[p.id].totalCost > 0)?.id
  const usage = usages[period].totalCost > 0 ? usages[period] : usages[firstAvailable ?? "today"]
  const entries = useMemo(() => buildStripEntries(usage, groupBy), [usage, groupBy])

  useEffect(() => {
    let active = true
    void Promise.all([loadOverviewGraphStyle(), loadOverviewGraphGroupBy()]).then(([storedStyle, storedGroupBy]) => {
      if (!active) return
      setGraphStyle(storedStyle)
      setGroupBy(storedGroupBy)
    })
    return () => {
      active = false
    }
  }, [])

  const colors = useMemo(
    () =>
      assignGraphEntryColors(
        entries.map((entry) => ({
          key: entry.key,
          brandColor: entry.brandColor,
          isOthers: entry.isOthers,
        })),
        groupBy,
        theme
      ),
    [entries, groupBy, theme]
  )

  if (!firstAvailable) return null

  const toggleGraphStyle = () => {
    const next: OverviewGraphStyle = graphStyle === "bar" ? "donut" : "bar"
    setGraphStyle(next)
    void saveOverviewGraphStyle(next)
  }

  const toggleGroupBy = () => {
    const next: OverviewGraphGroupBy = groupBy === "model" ? "provider" : "model"
    setGroupBy(next)
    void saveOverviewGraphGroupBy(next)
  }

  return (
    <div data-testid="models-today-strip" className="mb-3 rounded-xl border p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div role="radiogroup" aria-label="Period" className="flex min-w-0 gap-0.5">
          {PERIODS.map((p) => {
            const available = usages[p.id].totalCost > 0
            const isActive = p.id === period
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
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            aria-label={groupBy === "model" ? "Show providers" : "Show models"}
            onClick={toggleGroupBy}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {groupBy === "model" ? <ListTree className="size-3.5" /> : <LayoutGrid className="size-3.5" />}
          </button>
          <button
            type="button"
            aria-label={graphStyle === "bar" ? "Bar chart" : "Donut chart"}
            onClick={toggleGraphStyle}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {graphStyle === "bar" ? <ChartNoAxesGantt className="size-3.5" /> : <ChartPie className="size-3.5" />}
          </button>
        </div>
      </div>
      {graphStyle === "bar" ? (
        <>
          <div data-testid="strip-bar" className="flex h-2 gap-[2px] overflow-hidden rounded-full">
            {entries.map((entry) => (
              <Tooltip key={entry.key}>
                <TooltipTrigger
                  render={
                    <div
                      data-testid="strip-segment"
                      className="h-full transition-[filter] hover:brightness-125 first:rounded-l-full last:rounded-r-full"
                      style={{
                        width: `${entry.share * 100}%`,
                        minWidth: MIN_BAR_SEGMENT_PX,
                        backgroundColor: colors.get(entry.key),
                      }}
                    />
                  }
                />
                <TooltipContent side="top">{entry.tooltip}</TooltipContent>
              </Tooltip>
            ))}
          </div>
          <StripLegendBar entries={entries} colors={colors} />
        </>
      ) : (
        <div className="flex items-center gap-4">
          <StripDonut entries={entries} colors={colors} totalLabel={formatShareDonutTotal(usage.totalCost)} />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {entries.map((entry) => (
              <Tooltip key={entry.key}>
                <TooltipTrigger
                  render={
                    <div data-testid="strip-entry-row" className="flex items-center justify-between gap-3 text-xs">
                      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <span
                          className="size-[7px] shrink-0 rounded-[2px]"
                          style={{ backgroundColor: colors.get(entry.key) }}
                        />
                        <span className="truncate">{entry.label}</span>
                      </span>
                      <span className="tabular-nums">{formatShareCost(entry.cost)}</span>
                    </div>
                  }
                />
                <TooltipContent side="top">{entry.tooltip}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
