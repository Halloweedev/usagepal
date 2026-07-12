import { Fragment, useMemo } from "react"
import type { GraphEntry, GraphGroupBy } from "@/lib/today-models"
import { formatShareCost, formatSharePercent } from "@/lib/today-models"
import { deriveModelColors, OTHERS_COLORS } from "@/lib/graph-colors"
import { THEME_STYLES, type ShareCardTheme } from "@/components/share-card-theme"
import { ShareWatermark } from "@/components/share-watermark"
import { Donut } from "@/components/donut"
import { cn } from "@/lib/utils"

export type GraphStyle = "bar" | "donut"

export type ModelsGraphCardProps = {
  /** Already filtered to the user's selection and re-normalized. */
  entries: GraphEntry[]
  totalCost: number
  groupBy: GraphGroupBy
  graphStyle: GraphStyle
  theme: ShareCardTheme
  showPrices: boolean
  showWatermark: boolean
  /** Preformatted date (e.g. "Jul 10, 2026") — injected so tests are stable. */
  dateLabel: string
  /** Time window the numbers describe, woven into the headings ("today",
   * "yesterday", "30 days"). */
  periodLabel?: string
}

/** Colors follow the entity. Provider grouping: each slice takes its provider's
 * brand hue (like the Overview strip). Model grouping: each provider's models
 * step through shades of its hue in ranked order; the Others bucket is neutral.
 * Keyed by entry.key. */
export function assignEntryColors(
  entries: GraphEntry[],
  groupBy: GraphGroupBy,
  theme: ShareCardTheme
): Map<string, string> {
  const colors = new Map<string, string>()
  if (groupBy === "provider") {
    for (const entry of entries) colors.set(entry.key, deriveModelColors(entry.brandColor, 1, theme)[0])
    return colors
  }
  const byProvider = new Map<string, GraphEntry[]>()
  for (const entry of entries) {
    if (entry.isOthers) continue
    const group = byProvider.get(entry.providerId) ?? []
    group.push(entry)
    byProvider.set(entry.providerId, group)
  }
  for (const group of byProvider.values()) {
    const palette = deriveModelColors(group[0].brandColor, group.length, theme)
    group.forEach((entry, index) => colors.set(entry.key, palette[index]))
  }
  for (const entry of entries) {
    if (entry.isOthers) colors.set(entry.key, OTHERS_COLORS[theme])
  }
  return colors
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
const DONUT_CENTER = DONUT_SIZE / 2
const DONUT_GAP = 2
const DONUT_RADIUS = 50
const DONUT_STROKE = 18

// Floor so a ~1% or smaller slice still paints a visible block in the bar view.
const MIN_BAR_SEGMENT_PX = 4

function DonutChart({
  entries,
  colors,
  totalLabel,
  periodLabel,
}: {
  entries: GraphEntry[]
  colors: Map<string, string>
  totalLabel: string
  periodLabel: string
}) {
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
      <text
        x={DONUT_CENTER}
        y={DONUT_CENTER - 2}
        textAnchor="middle"
        fill="currentColor"
        fontSize={18}
        fontWeight={600}
      >
        {totalLabel}
      </text>
      <text
        x={DONUT_CENTER}
        y={DONUT_CENTER + 14}
        textAnchor="middle"
        fill="currentColor"
        opacity={0.6}
        fontSize={10}
      >
        {periodLabel}
      </text>
    </Donut>
  )
}

export function ModelsGraphCard({
  entries,
  totalCost,
  groupBy,
  graphStyle,
  theme,
  showPrices,
  showWatermark,
  dateLabel,
  periodLabel = "today",
}: ModelsGraphCardProps) {
  const styles = THEME_STYLES[theme]
  const colors = useMemo(() => assignEntryColors(entries, groupBy, theme), [entries, groupBy, theme])
  const heading = groupBy === "model" ? `Models used ${periodLabel}` : `Usage ${periodLabel}`

  const list = (
    <div
      data-testid="models-graph-list"
      className="grid items-baseline gap-x-3 gap-y-1.5"
      style={{
        gridTemplateColumns: showPrices
          ? "auto minmax(0, 1fr) max-content max-content"
          : "auto minmax(0, 1fr) max-content",
      }}
    >
      {entries.map((entry) => (
        <Fragment key={entry.key}>
          <span className="size-[9px] self-center rounded-[3px]" style={{ backgroundColor: colors.get(entry.key) }} />
          <span data-testid="models-graph-row" className="truncate text-sm">
            {entry.name}
          </span>
          <span className={cn("text-right text-xs tabular-nums", styles.subtext)}>
            {formatSharePercent(entry.share)}
          </span>
          {showPrices && (
            <span className="text-right text-xs tabular-nums">{formatShareCost(entry.todayCost)}</span>
          )}
        </Fragment>
      ))}
    </div>
  )

  return (
    // Full-bleed frame like ShareCard: hosts fill PNG transparency with their
    // own background, so the exported node keeps square opaque corners.
    <div data-testid="models-graph-card" className={cn("flex w-[440px] flex-col p-2", styles.frame, styles.text)}>
      <div className={cn("flex flex-col gap-4 rounded-xl border p-5", styles.bg, styles.border)}>
        <div className="flex items-baseline justify-between">
          <span className="text-base font-semibold">{heading}</span>
          <span className={cn("text-xs", styles.subtext)}>{dateLabel}</span>
        </div>
        {graphStyle === "bar" ? (
          <>
            <StackedBar entries={entries} colors={colors} />
            {list}
          </>
        ) : (
          <div className="flex items-center gap-6">
            <DonutChart
              entries={entries}
              colors={colors}
              totalLabel={formatShareCost(totalCost)}
              periodLabel={periodLabel}
            />
            <div className="min-w-0 flex-1">{list}</div>
          </div>
        )}
        {showPrices && (
          <div data-testid="models-graph-total" className="flex items-center justify-between text-sm font-semibold">
            <span>Total {periodLabel}</span>
            <span className="tabular-nums">{formatShareCost(totalCost)}</span>
          </div>
        )}
      </div>
      {showWatermark && <ShareWatermark subtextClassName={styles.subtext} />}
    </div>
  )
}
