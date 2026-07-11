import { Fragment, useMemo } from "react"
import type { TodayModelEntry, TodayModelUsage } from "@/lib/today-models"
import { formatShareCost, formatSharePercent } from "@/lib/today-models"
import { deriveModelColors, OTHERS_COLORS } from "@/lib/graph-colors"
import { THEME_STYLES, type ShareCardTheme } from "@/components/share-card-theme"
import { ShareWatermark } from "@/components/share-watermark"
import { cn } from "@/lib/utils"
import { donutSegments } from "@/lib/donut-math"

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
          style={{ width: `${model.share * 100}%`, backgroundColor: colors.get(model) }}
        />
      ))}
    </div>
  )
}

const DONUT_SIZE = 132
const DONUT_CENTER = DONUT_SIZE / 2
// Segment gap in pathLength units (of 100), rendered by shortening each dash.
const DONUT_GAP = 0.8

function DonutChart({
  models,
  colors,
  totalLabel,
}: {
  models: TodayModelEntry[]
  colors: Map<TodayModelEntry, string>
  totalLabel: string
}) {
  const segments = donutSegments(
    models.map((model) => model.share),
    DONUT_GAP
  )
  return (
    <svg
      data-testid="models-graph-donut"
      width={DONUT_SIZE}
      height={DONUT_SIZE}
      viewBox={`0 0 ${DONUT_SIZE} ${DONUT_SIZE}`}
      className="shrink-0"
    >
      {segments.map(({ start, visible }, index) => {
        const model = models[index]
        return (
          <circle
            key={modelKey(model)}
            cx={DONUT_CENTER}
            cy={DONUT_CENTER}
            r={45}
            fill="none"
            strokeWidth={26}
            pathLength={100}
            stroke={colors.get(model)}
            strokeDasharray={`${visible} ${100 - visible}`}
            strokeDashoffset={-(start + DONUT_GAP / 2)}
            // Start segments at 12 o'clock instead of SVG's 3 o'clock default.
            transform={`rotate(-90 ${DONUT_CENTER} ${DONUT_CENTER})`}
          />
        )
      })}
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
        today
      </text>
    </svg>
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
          <span className="text-base font-semibold">Models used today</span>
          <span className={cn("text-xs", styles.subtext)}>{dateLabel}</span>
        </div>
        {graphStyle === "bar" ? (
          <>
            <StackedBar models={usage.models} colors={colors} />
            {list}
          </>
        ) : (
          <div className="flex items-center gap-6">
            <DonutChart models={usage.models} colors={colors} totalLabel={formatShareCost(usage.totalCost)} />
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
            <span>Total today</span>
            <span className="tabular-nums">{formatShareCost(usage.totalCost)}</span>
          </div>
        )}
      </div>
      {showWatermark && <ShareWatermark subtextClassName={styles.subtext} />}
    </div>
  )
}
