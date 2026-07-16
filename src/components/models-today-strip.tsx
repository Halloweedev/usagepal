import { useEffect, useMemo, useState } from "react"
import { ChartBarHorizontal, ChartPie, SquaresFour, TreeView } from "@phosphor-icons/react"
import { ExportIcon } from "@/components/export-icon"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Donut, DonutCenterTotal } from "@/components/donut"
import { useDarkMode } from "@/hooks/use-dark-mode"
import { assignGraphEntryColors } from "@/lib/graph-colors"
import { cn } from "@/lib/utils"
import {
  loadOverviewGraphGroupBy,
  loadOverviewGraphStyle,
  loadOverviewStripMetric,
  saveOverviewGraphGroupBy,
  saveOverviewGraphStyle,
  saveOverviewStripMetric,
  type OverviewGraphGroupBy,
  type OverviewGraphStyle,
  type OverviewStripMetric,
} from "@/lib/settings"
import { useAppShareStore } from "@/stores/app-share-store"
import { useAppUiStore } from "@/stores/app-ui-store"
import {
  ALL_SHARE_TAB_ID,
  buildModelUsage,
  formatShareCost,
  formatShareDonutTotal,
  formatSharePercent,
  formatSharePricePerMillion,
  formatShareTokens,
  formatShareTokensStackedTotal,
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
  tokenCount: number | null
  brandColor: string | null
  isOthers?: boolean
  tooltip: React.ReactNode
}

/** Clickable metric value that flips the whole strip between $ and tokens. */
function MetricToggleValue({ value, onToggle }: { value: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      data-testid="strip-metric-toggle"
      aria-label="Toggle between cost and token values"
      onClick={onToggle}
      className="cursor-pointer tabular-nums text-right"
    >
      {value}
    </button>
  )
}

/** Header value for tooltips: cost in price mode, tokens in usage mode. */
function tooltipHeadline(metric: OverviewStripMetric, cost: number, tokenCount: number | null): string {
  if (metric === "price") return formatShareCost(cost)
  return tokenCount != null ? formatShareTokens(tokenCount) : "—"
}

/** Muted cost / $-per-MTok line shown under tooltip headers in usage mode. */
function TooltipCostLine({ cost, tokenCount }: { cost: number; tokenCount: number | null }) {
  const perMillion = formatSharePricePerMillion(cost, tokenCount)
  return (
    <span className="flex justify-between gap-4 tabular-nums text-muted-foreground">
      <span>{formatShareCost(cost)}</span>
      {perMillion != null && <span>{perMillion}</span>}
    </span>
  )
}

function ModelTooltip({ model, metric }: { model: TodayModelEntry; metric: OverviewStripMetric }) {
  const providers =
    model.providerNames.length > 0 ? model.providerNames : model.providerName ? [model.providerName] : []
  return (
    <div className="flex min-w-40 flex-col gap-1 text-xs">
      <span className="flex justify-between gap-4 font-semibold">
        <span>{model.name}</span>
        <span className="tabular-nums">{tooltipHeadline(metric, model.todayCost, model.tokenCount)}</span>
      </span>
      {metric === "usage" && <TooltipCostLine cost={model.todayCost} tokenCount={model.tokenCount} />}
      {!model.isOthers && providers.length > 0 && (
        <span className="text-muted-foreground">{providers.join(" · ")}</span>
      )}
    </div>
  )
}

function ProviderTooltip({ provider, metric }: { provider: TodayProviderEntry; metric: OverviewStripMetric }) {
  return (
    <div className="flex min-w-40 flex-col gap-1 text-xs">
      <span className="flex justify-between gap-4 font-semibold">
        <span>{provider.name}</span>
        <span className="tabular-nums">{tooltipHeadline(metric, provider.todayCost, provider.tokenCount)}</span>
      </span>
      {metric === "usage" && <TooltipCostLine cost={provider.todayCost} tokenCount={provider.tokenCount} />}
      <div className="border-t" />
      {provider.models.map((model) => (
        <span key={modelEntryKey(model)} className="flex justify-between gap-4 text-muted-foreground">
          <span className="truncate">{model.name}</span>
          <span className="shrink-0 tabular-nums">
            {formatSharePercent(model.todayCost / provider.todayCost)}{" "}
            <span className="text-foreground">
              {tooltipHeadline(metric, model.todayCost, model.tokenCount)}
            </span>
          </span>
        </span>
      ))}
    </div>
  )
}

function StripLegendBar({
  entries,
  colors,
  metric,
  onMetricToggle,
}: {
  entries: StripEntry[]
  colors: Map<string, string>
  metric: OverviewStripMetric
  onMetricToggle: () => void
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
                    <MetricToggleValue
                      value={
                        metric === "usage"
                          ? entry.tokenCount != null
                            ? formatShareTokens(entry.tokenCount)
                            : "—"
                          : formatSharePercent(entry.share)
                      }
                      onToggle={onMetricToggle}
                    />
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
  totalUnit,
  onCenterClick,
}: {
  entries: StripEntry[]
  colors: Map<string, string>
  totalLabel: string
  totalUnit?: string
  onCenterClick: () => void
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
      <g
        role="button"
        aria-label="Toggle between cost and token values"
        className="cursor-pointer"
        onClick={onCenterClick}
      >
        <DonutCenterTotal donutSize={DONUT_SIZE} label={totalLabel} unit={totalUnit} />
      </g>
    </Donut>
  )
}

function buildStripEntries(
  usage: ReturnType<typeof buildModelUsage>,
  groupBy: OverviewGraphGroupBy,
  metric: OverviewStripMetric
): StripEntry[] {
  if (groupBy === "provider") {
    return usage.providers.map((provider) => ({
      key: provider.id,
      label: provider.name,
      share: provider.share,
      cost: provider.todayCost,
      tokenCount: provider.tokenCount,
      brandColor: provider.brandColor,
      tooltip: <ProviderTooltip provider={provider} metric={metric} />,
    }))
  }
  return usage.models.map((model) => ({
    key: modelEntryKey(model),
    label: model.name,
    share: model.share,
    cost: model.todayCost,
    tokenCount: model.tokenCount,
    brandColor: model.brandColor,
    isOthers: model.isOthers,
    tooltip: <ModelTooltip model={model} metric={metric} />,
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
  const [metric, setMetric] = useState<OverviewStripMetric>("price")
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
  const activePeriod = usages[period].totalCost > 0 ? period : (firstAvailable ?? "today")
  const usage = usages[activePeriod]
  const entries = useMemo(() => buildStripEntries(usage, groupBy, metric), [usage, groupBy, metric])

  useEffect(() => {
    let active = true
    void Promise.all([loadOverviewGraphStyle(), loadOverviewGraphGroupBy(), loadOverviewStripMetric()]).then(
      ([storedStyle, storedGroupBy, storedMetric]) => {
        if (!active) return
        setGraphStyle(storedStyle)
        setGroupBy(storedGroupBy)
        setMetric(storedMetric)
      }
    )
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

  const toggleMetric = () => {
    const next: OverviewStripMetric = metric === "price" ? "usage" : "price"
    setMetric(next)
    void saveOverviewStripMetric(next)
  }

  /** Hand this exact view (tab, grouping, style, metric, period) to the Share page. */
  const openInShare = () => {
    useAppShareStore.getState().patch({
      selectedId: ALL_SHARE_TAB_ID,
      graphStyle,
      graphGroupBy: groupBy,
      graphMetric: metric,
    })
    useAppShareStore.getState().setPendingGraphPeriod(activePeriod)
    useAppUiStore.getState().setActiveView("share")
  }

  const totalTokens = entries.reduce((sum, entry) => sum + (entry.tokenCount ?? 0), 0)
  const tokensTotalDisplay = totalTokens > 0 ? formatShareTokensStackedTotal(totalTokens) : null
  const donutCenter: { label: string; unit?: string } =
    metric === "usage"
      ? tokensTotalDisplay == null
        ? { label: "—" }
        : tokensTotalDisplay.kind === "stacked"
          ? { label: tokensTotalDisplay.amount, unit: tokensTotalDisplay.unit }
          : { label: tokensTotalDisplay.value }
      : { label: formatShareDonutTotal(usage.totalCost) }

  return (
    <div data-testid="models-today-strip" className="mb-3 rounded-xl border p-1.5">
      {/* Controls pill: lives above the chart area so the content below is
          exactly what a share/export would show. */}
      <div className="flex items-center justify-between gap-2 rounded-full bg-muted/50 py-1 pl-1 pr-2.5">
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
                  "rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors",
                  isActive
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
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
            {groupBy === "model" ? <TreeView className="size-3.5" /> : <SquaresFour className="size-3.5" />}
          </button>
          <button
            type="button"
            aria-label={graphStyle === "bar" ? "Bar chart" : "Donut chart"}
            onClick={toggleGraphStyle}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            {graphStyle === "bar" ? <ChartBarHorizontal className="size-3.5" /> : <ChartPie className="size-3.5" />}
          </button>
          <button
            type="button"
            aria-label="Share this view"
            onClick={openInShare}
            className="text-muted-foreground transition-colors hover:text-foreground"
          >
            <ExportIcon className="size-4" />
          </button>
        </div>
      </div>
      {/* Chart area: the shareable content, kept free of controls. */}
      <div className="px-1.5 pb-1.5 pt-3">
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
          <StripLegendBar entries={entries} colors={colors} metric={metric} onMetricToggle={toggleMetric} />
        </>
      ) : (
        <div className="flex items-center gap-4">
          <StripDonut
            entries={entries}
            colors={colors}
            totalLabel={donutCenter.label}
            totalUnit={donutCenter.unit}
            onCenterClick={toggleMetric}
          />
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
                      <MetricToggleValue
                        value={
                          metric === "usage"
                            ? entry.tokenCount != null
                              ? formatShareTokens(entry.tokenCount)
                              : "—"
                            : formatShareCost(entry.cost)
                        }
                        onToggle={toggleMetric}
                      />
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
    </div>
  )
}
