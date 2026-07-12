import { Fragment, useMemo } from "react"
import type { TodayModelEntry, TodayModelUsage } from "@/lib/today-models"
import { formatShareCost, formatSharePercent } from "@/lib/today-models"
import { deriveModelColors, OTHERS_COLORS } from "@/lib/graph-colors"
import { THEME_STYLES, type ShareCardTheme } from "@/components/share-card-theme"
import { ShareWatermark } from "@/components/share-watermark"
import { Donut } from "@/components/donut"
import { cn } from "@/lib/utils"

export type GraphStyle = "bar" | "donut"

export type ModelsGraphCardProps = {
  usage: TodayModelUsage
  graphStyle: GraphStyle
  theme: ShareCardTheme
  showModelPrices: boolean
  showProviderPrices: boolean
  showWatermark: boolean
  /** Preformatted date (e.g. "Jul 10, 2026") — injected so tests are stable. */
  dateLabel: string
  /** Time window the numbers describe, woven into the headings ("today",
   * "yesterday", "30 days"). */
  periodLabel?: string
}

/** Colors follow the entity: each provider's brand hue in shade steps assigned
 * in ranked order within that provider; the Others bucket gets the neutral. */
export function assignModelColors(
  models: TodayModelEntry[],
  theme: ShareCardTheme
): Map<TodayModelEntry, string> {
  const byProvider = new Map<string, TodayModelEntry[]>()
  for (const model of models) {
    if (model.isOthers) continue
    const group = byProvider.get(model.providerId) ?? []
    group.push(model)
    byProvider.set(model.providerId, group)
  }
  const colors = new Map<TodayModelEntry, string>()
  for (const group of byProvider.values()) {
    const palette = deriveModelColors(group[0].brandColor, group.length, theme)
    group.forEach((model, index) => colors.set(model, palette[index]))
  }
  for (const model of models) {
    if (model.isOthers) colors.set(model, OTHERS_COLORS[theme])
  }
  return colors
}

const modelKey = (model: TodayModelEntry) => `${model.providerId}-${model.name}`

function StackedBar({
  models,
  colors,
}: {
  models: TodayModelEntry[]
  colors: Map<TodayModelEntry, string>
}) {
  return (
    <div data-testid="models-graph-bar" className="flex h-3 gap-[2px] overflow-hidden rounded-full">
      {models.map((model) => (
        <div
          key={modelKey(model)}
          data-testid="models-graph-segment"
          className="h-full rounded-[2px] first:rounded-l-full last:rounded-r-full"
          style={{
            width: `${model.share * 100}%`,
            minWidth: MIN_BAR_SEGMENT_PX,
            backgroundColor: colors.get(model),
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

// Floor so a ~1% or smaller model still paints a visible block in the bar view.
const MIN_BAR_SEGMENT_PX = 4

function DonutChart({
  models,
  colors,
  totalLabel,
  periodLabel,
}: {
  models: TodayModelEntry[]
  colors: Map<TodayModelEntry, string>
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
      slices={models.map((model) => ({
        key: modelKey(model),
        share: model.share,
        color: colors.get(model) ?? "currentColor",
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
  usage,
  graphStyle,
  theme,
  showModelPrices,
  showProviderPrices,
  showWatermark,
  dateLabel,
  periodLabel = "today",
}: ModelsGraphCardProps) {
  const styles = THEME_STYLES[theme]
  const colors = useMemo(() => assignModelColors(usage.models, theme), [usage, theme])
  const showTotal = showModelPrices || showProviderPrices

  const list = (
    <div
      data-testid="models-graph-list"
      className="grid items-baseline gap-x-3 gap-y-1.5"
      style={{
        gridTemplateColumns: showModelPrices
          ? "auto minmax(0, 1fr) max-content max-content"
          : "auto minmax(0, 1fr) max-content",
      }}
    >
      {usage.models.map((model) => (
        <Fragment key={modelKey(model)}>
          <span className="size-[9px] self-center rounded-[3px]" style={{ backgroundColor: colors.get(model) }} />
          <span data-testid="models-graph-row" className="truncate text-sm">
            {model.name}
          </span>
          <span className={cn("text-right text-xs tabular-nums", styles.subtext)}>
            {formatSharePercent(model.share)}
          </span>
          {showModelPrices && (
            <span className="text-right text-xs tabular-nums">{formatShareCost(model.todayCost)}</span>
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
          <span className="text-base font-semibold">Models used {periodLabel}</span>
          <span className={cn("text-xs", styles.subtext)}>{dateLabel}</span>
        </div>
        {graphStyle === "bar" ? (
          <>
            <StackedBar models={usage.models} colors={colors} />
            {list}
          </>
        ) : (
          <div className="flex items-center gap-6">
            <DonutChart
              models={usage.models}
              colors={colors}
              totalLabel={formatShareCost(usage.totalCost)}
              periodLabel={periodLabel}
            />
            <div className="min-w-0 flex-1">{list}</div>
          </div>
        )}
        {showProviderPrices && (
          <div data-testid="models-graph-providers" className={cn("flex flex-col gap-1.5 border-t pt-3", styles.border)}>
            {usage.providers.map((provider) => (
              <div key={provider.id} className={cn("flex items-center justify-between text-xs", styles.subtext)}>
                <span>{provider.name}</span>
                <span className="tabular-nums">{formatShareCost(provider.todayCost)}</span>
              </div>
            ))}
          </div>
        )}
        {showTotal && (
          <div data-testid="models-graph-total" className="flex items-center justify-between text-sm font-semibold">
            <span>Total {periodLabel}</span>
            <span className="tabular-nums">{formatShareCost(usage.totalCost)}</span>
          </div>
        )}
      </div>
      {showWatermark && <ShareWatermark subtextClassName={styles.subtext} />}
    </div>
  )
}
