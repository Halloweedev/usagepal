import { Fragment, useMemo } from "react"
import type { GraphEntry, GraphGroupBy, GraphMetric, ShareMetricDisplay } from "@/lib/today-models"
import {
  formatGraphMetricLegendValue,
  formatGraphMetricTotal,
  formatShareCost,
  graphMetricHeading,
  graphMetricTitle,
} from "@/lib/today-models"
import { assignGraphEntryColors } from "@/lib/graph-colors"
import { THEME_STYLES, type ShareCardTheme } from "@/components/share-card-theme"
import { ShareWatermark } from "@/components/share-watermark"
import { Donut, DonutCenterTotal } from "@/components/donut"
import { cn } from "@/lib/utils"

export type GraphStyle = "bar" | "donut"

export type ModelsGraphCardProps = {
  /** Already filtered to the user's selection and re-normalized. */
  entries: GraphEntry[]
  totalCost: number
  totalTokens: number
  metric: GraphMetric
  groupBy: GraphGroupBy
  graphStyle: GraphStyle
  theme: ShareCardTheme
  showBreakdown: boolean
  showTotal: boolean
  showDate: boolean
  showWatermark: boolean
  /** Preformatted date (e.g. "Jul 10, 2026") — injected so tests are stable. */
  dateLabel: string
  /** Time window the numbers describe, woven into the headings ("today",
   * "yesterday", "30 days"). */
  periodLabel?: string
}

/** @deprecated Use assignGraphEntryColors from @/lib/graph-colors */
export function assignEntryColors(
  entries: GraphEntry[],
  groupBy: GraphGroupBy,
  theme: ShareCardTheme
): Map<string, string> {
  return assignGraphEntryColors(entries, groupBy, theme)
}

function StackedBar({ entries, colors }: { entries: GraphEntry[]; colors: Map<string, string> }) {
  return (
    <div data-testid="models-graph-bar" className="flex h-3 gap-[2px] overflow-hidden rounded-full">
      {entries.map((entry) => (
        <div
          key={entry.key}
          data-testid="models-graph-segment"
          className="h-full rounded-[2px] first:rounded-l-full last:rounded-r-full"
          style={{
            width: `${entry.share * 100}%`,
            minWidth: MIN_BAR_SEGMENT_PX,
            backgroundColor: colors.get(entry.key),
          }}
        />
      ))}
    </div>
  )
}

// Slim proportions matching the Overview strip donut (stroke/radius ≈ 0.36),
// scaled up to this card's larger canvas.
const DONUT_SIZE = 132
const DONUT_GAP = 0.8
const DONUT_RADIUS = 50
const DONUT_STROKE = 18

// Floor so a ~1% or smaller slice still paints a visible block in the bar view.
const MIN_BAR_SEGMENT_PX = 5

function ShareMetricValue({
  display,
  unitClassName,
}: {
  display: ShareMetricDisplay | null
  unitClassName?: string
}) {
  if (!display) return <>—</>
  if (display.kind === "plain") {
    return <span className="font-semibold tabular-nums">{display.value}</span>
  }
  return (
    <span className="inline-flex flex-col items-center gap-1 text-center">
      <span className="font-semibold tabular-nums leading-none">{display.amount}</span>
      <span className={cn("text-[11px] font-normal leading-none", unitClassName)}>{display.unit}</span>
    </span>
  )
}

function donutCenterFromDisplay(display: ShareMetricDisplay): { label: string; unit?: string } {
  if (display.kind === "plain") return { label: display.value }
  return { label: display.amount, unit: display.unit }
}

function DonutChart({
  entries,
  colors,
  showTotal,
  totalDisplay,
}: {
  entries: GraphEntry[]
  colors: Map<string, string>
  showTotal: boolean
  totalDisplay: ShareMetricDisplay
}) {
  const center = donutCenterFromDisplay(totalDisplay)
  return (
    <Donut
      size={DONUT_SIZE}
      radius={DONUT_RADIUS}
      stroke={DONUT_STROKE}
      gap={DONUT_GAP}
      testId="models-graph-donut"
      slices={entries.map((entry) => ({
        key: entry.key,
        share: entry.share,
        color: colors.get(entry.key) ?? "currentColor",
      }))}
    >
      {showTotal && <DonutCenterTotal donutSize={DONUT_SIZE} label={center.label} unit={center.unit} />}
    </Donut>
  )
}

export function ModelsGraphCard({
  entries,
  totalCost,
  totalTokens,
  metric,
  groupBy,
  graphStyle,
  theme,
  showBreakdown,
  showTotal,
  showDate,
  showWatermark,
  dateLabel,
  periodLabel = "today",
}: ModelsGraphCardProps) {
  const styles = THEME_STYLES[theme]
  const colors = useMemo(() => assignGraphEntryColors(entries, groupBy, theme), [entries, groupBy, theme])
  const heading = graphMetricHeading(metric, groupBy, periodLabel)
  const metricTitle = graphMetricTitle(metric)
  const totalDisplay: ShareMetricDisplay =
    metric === "price" && graphStyle === "bar"
      ? { kind: "plain", value: formatShareCost(totalCost) }
      : formatGraphMetricTotal(metric, totalCost, totalTokens)

  const list = showBreakdown ? (
    <div
      data-testid="models-graph-list"
      className="grid items-baseline gap-x-3 gap-y-2"
      style={{ gridTemplateColumns: "auto minmax(0, 1fr) max-content" }}
    >
      {entries.map((entry) => (
        <Fragment key={entry.key}>
          <span className="size-[11px] self-center rounded-[3px]" style={{ backgroundColor: colors.get(entry.key) }} />
          <span data-testid="models-graph-row" className="truncate text-base font-medium">
            {entry.name}
          </span>
          <span className={cn("text-right text-base font-semibold tabular-nums", styles.subtext)}>
            {formatGraphMetricLegendValue(metric, entry) ?? "—"}
          </span>
        </Fragment>
      ))}
    </div>
  ) : null

  const totalFooter = showTotal && graphStyle === "bar" ? (
    <div data-testid="models-graph-total" className="flex items-center justify-between text-base font-semibold">
      <span>
        Total {metricTitle} {periodLabel}
      </span>
      <ShareMetricValue display={totalDisplay} unitClassName={styles.subtext} />
    </div>
  ) : null

  return (
    // Full-bleed frame like ShareCard: hosts fill PNG transparency with their
    // own background, so the exported node keeps square opaque corners.
    <div data-testid="models-graph-card" className={cn("flex w-[440px] flex-col p-2", styles.frame, styles.text)}>
      <div className={cn("flex flex-col gap-4 rounded-xl border p-5", styles.bg, styles.border)}>
        <div className={cn("flex items-baseline", showDate && "justify-between")}>
          <span className="text-base font-semibold">{heading}</span>
          {showDate && <span className={cn("text-xs", styles.subtext)}>{dateLabel}</span>}
        </div>
        {graphStyle === "bar" ? (
          <>
            <StackedBar entries={entries} colors={colors} />
            {list}
            {totalFooter}
          </>
        ) : (
          <div className={cn("flex items-center", showBreakdown ? "gap-6" : "justify-center")}>
            <DonutChart entries={entries} colors={colors} showTotal={showTotal} totalDisplay={totalDisplay} />
            {list && <div className="min-w-0 flex-1">{list}</div>}
          </div>
        )}
      </div>
      {showWatermark && <ShareWatermark subtextClassName={styles.subtext} />}
    </div>
  )
}
