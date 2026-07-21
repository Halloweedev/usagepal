import { Fragment } from "react"
import type { MetricLine } from "@/lib/plugin-types"
import type { ModelBreakdownParsed, ModelDisplayOptions } from "@/lib/model-breakdown-format"
import { parseModelBreakdownValue } from "@/lib/model-breakdown-format"
import { cn, clamp01, formatCountNumber } from "@/lib/utils"
import { ShareWatermark } from "@/components/share-watermark"
import { ProviderIconMask } from "@/components/provider-icon-mask"
import { THEME_STYLES } from "@/components/share-card-theme"
import type { ShareCardTheme, ThemeStyle } from "@/components/share-card-theme"

export type { ShareCardTheme }

type ProgressMetricLine = Extract<MetricLine, { type: "progress" }> & { used: number; limit: number }
type UsableBarChartPoint = Extract<MetricLine, { type: "barChart" }>["points"][number] & { value: number }

function hasProgressValues(line: Extract<MetricLine, { type: "progress" }>): line is ProgressMetricLine {
  return line.used != null && line.limit != null
}

export type ShareCardProps = {
  providerName: string
  providerId?: string
  providerIconUrl: string
  brandColor?: string
  plan?: string
  lines: MetricLine[]
  theme: ShareCardTheme
  showWatermark: boolean
  modelDisplay?: ModelDisplayOptions
  modelBreakdownLabels?: Set<string>
  /** Show token counts alongside costs in text rows (default on). */
  showTokens?: boolean
}

function progressValueLabel(line: ProgressMetricLine, percent: number): string {
  if (line.format.kind === "percent") return `${Math.round(percent)}%`
  if (line.format.kind === "dollars") {
    return `$${formatCountNumber(line.used)} / $${formatCountNumber(line.limit)}`
  }
  return `${formatCountNumber(line.used)} / ${formatCountNumber(line.limit)} ${line.format.suffix}`
}

function ProgressRow({
  line,
  styles,
  brandColor,
}: {
  line: ProgressMetricLine
  styles: ThemeStyle
  brandColor?: string
}) {
  const percent = line.limit > 0 ? clamp01(line.used / line.limit) * 100 : 0
  return (
    <div data-testid="share-card-line-progress" className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <span className="text-sm">{line.label}</span>
        <span className={cn("text-xs", styles.subtext)}>{progressValueLabel(line, percent)}</span>
      </div>
      <div className={cn("h-1.5 w-full overflow-hidden rounded-full", styles.track)}>
        <div
          className="h-full rounded-full"
          style={{ width: `${percent}%`, backgroundColor: brandColor ?? "currentColor" }}
        />
      </div>
    </div>
  )
}

/** Matches "cost · tokens" values (e.g. "$114.66 · 137M") so the token part
 * can be hidden or laid out as its own column. */
const COST_TOKEN_VALUE_RE = /^(.+?) · (\d+(?:\.\d+)?[KMB])$/

function TextRow({
  line,
  styles,
  showTokens,
}: {
  line: Extract<MetricLine, { type: "text" }>
  styles: ThemeStyle
  showTokens: boolean
}) {
  const costTokenMatch = COST_TOKEN_VALUE_RE.exec(line.value)
  return (
    <div data-testid="share-card-line-text" className="flex items-center justify-between">
      <span className="text-sm">{line.label}</span>
      {costTokenMatch ? (
        <span className="flex items-baseline text-xs tabular-nums">
          {showTokens && <span className={styles.subtext}>{costTokenMatch[2]}</span>}
          <span className="min-w-16 text-right">{costTokenMatch[1]}</span>
        </span>
      ) : (
        <span className="text-xs">{line.value}</span>
      )}
    </div>
  )
}

function BadgeRow({ line, styles }: { line: Extract<MetricLine, { type: "badge" }>; styles: ThemeStyle }) {
  return (
    <div data-testid="share-card-line-badge" className="flex items-center justify-between">
      <span className="text-sm">{line.label}</span>
      <span
        className={cn("rounded-full border px-2 py-1 text-xs", line.color ? undefined : styles.border)}
        style={line.color ? { color: line.color, borderColor: line.color } : undefined}
      >
        {line.text}
      </span>
    </div>
  )
}

type ModelRow = {
  line: Extract<MetricLine, { type: "text" }>
  parsed: ModelBreakdownParsed
}

type ModelColumn = {
  key: string
  header: string
  value: (parsed: ModelBreakdownParsed) => string | undefined
}

/**
 * Drops the cents from a model cost cell ("$11.44" → "$11") so shared images
 * read cleanly. Rounds to the nearest dollar and leaves any non-currency text
 * (e.g. the percent share) untouched.
 */
function stripCostCents(value: string | undefined): string | undefined {
  if (value == null) return value
  return value.replace(/\$[\d,]+\.\d+/g, (match) => {
    const amount = Number(match.replace(/[$,]/g, ""))
    return `$${Math.round(amount).toLocaleString("en-US")}`
  })
}

/**
 * Model breakdown as an aligned table — one row per model, one right-aligned
 * column per enabled metric — instead of a per-model blurb line, so values
 * are comparable at a glance.
 */
function ModelBreakdownTable({
  rows,
  styles,
  modelDisplay,
}: {
  rows: ModelRow[]
  styles: ThemeStyle
  modelDisplay: ModelDisplayOptions
}) {
  const columns: ModelColumn[] = [
    modelDisplay.showPercent && { key: "percent", header: "%", value: (parsed: ModelBreakdownParsed) => parsed.percent },
    modelDisplay.showToday && { key: "today", header: "Today", value: (parsed: ModelBreakdownParsed) => stripCostCents(parsed.today) },
    modelDisplay.showSevenDay && { key: "sevenDay", header: "7d", value: (parsed: ModelBreakdownParsed) => stripCostCents(parsed.sevenDay) },
    modelDisplay.showThirtyDay && { key: "thirtyDay", header: "30d", value: (parsed: ModelBreakdownParsed) => stripCostCents(parsed.thirtyDay) },
  ].filter((column): column is ModelColumn => Boolean(column))

  return (
    <div
      data-testid="share-card-models"
      className="grid items-baseline gap-x-3 gap-y-1.5"
      style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${columns.length}, max-content)` }}
    >
      <span className={cn("text-[11px] font-medium", styles.subtext)}>Model</span>
      {columns.map((column) => (
        <span
          key={column.key}
          className={cn("text-right text-[11px] font-medium", styles.subtext)}
        >
          {column.header}
        </span>
      ))}
      {rows.map(({ line, parsed }) => (
        <Fragment key={line.label}>
          <span data-testid="share-card-line-model-breakdown" className="truncate text-sm">
            {line.label}
          </span>
          {columns.map((column) => {
            const value = column.value(parsed)
            return (
              <span
                key={column.key}
                className={cn("text-right text-xs tabular-nums", value ? undefined : styles.subtext)}
              >
                {value ?? "–"}
              </span>
            )
          })}
        </Fragment>
      ))}
    </div>
  )
}

function BarChartRow({
  line,
  styles,
  brandColor,
}: {
  line: Extract<MetricLine, { type: "barChart" }>
  styles: ThemeStyle
  brandColor?: string
}) {
  const valid = line.points.filter((point): point is UsableBarChartPoint => point.value != null && Number.isFinite(point.value) && point.value >= 0)
  const maxValue = Math.max(1, ...valid.map((point) => point.value))

  // Deliberately unlabeled: in a usage card the trend bars read on their own,
  // and a floating title made the row feel unbalanced.
  return (
    <div data-testid="share-card-line-barchart" className="flex h-8 items-end gap-px">
      {valid.map((point, index) => (
        <div
          key={`${point.label}-${index}`}
          className={cn("min-w-[2px] flex-1 rounded-[1px]", styles.track)}
          style={{
            height: `${Math.max(8, clamp01(point.value / maxValue) * 100)}%`,
            backgroundColor: brandColor ?? "currentColor",
          }}
        />
      ))}
    </div>
  )
}

export function ShareCard({
  providerName,
  providerId,
  providerIconUrl,
  brandColor,
  plan,
  lines,
  theme,
  showWatermark,
  modelDisplay,
  modelBreakdownLabels,
  showTokens = true,
}: ShareCardProps) {
  const styles = THEME_STYLES[theme]
  const displayOptions = modelDisplay ?? {
    showPercent: true,
    showToday: true,
    showSevenDay: true,
    showThirtyDay: true,
  }

  // Model breakdown lines render together as a table after the other lines;
  // a model-classified line that doesn't parse falls back to a plain text row.
  const modelRows: ModelRow[] = []
  const otherLines: MetricLine[] = []
  for (const line of lines) {
    if (line.type === "text" && modelBreakdownLabels?.has(line.label)) {
      const parsed = parseModelBreakdownValue(line.value)
      if (parsed) {
        modelRows.push({ line, parsed })
        continue
      }
    }
    otherLines.push(line)
  }

  return (
    // Main card: frames the info card and carries the branded footer. Kept
    // full-bleed (square, opaque, no outer border): hosts like Threads fill
    // PNG transparency with their own background, so rounded outer corners
    // export as visible artifacts.
    <div
      data-testid="share-card"
      className={cn("flex w-[440px] flex-col p-2", styles.frame, styles.text)}
    >
      <div
        data-testid="share-card-surface"
        className={cn("flex flex-col gap-4 rounded-xl border p-5", styles.bg, styles.border)}
      >
        <div className="flex items-center gap-2">
        <ProviderIconMask
          iconUrl={providerIconUrl}
          pluginId={providerId}
          sizePx={20}
          className={cn(styles.text)}
          style={{ backgroundColor: "currentColor" }}
        />
        <span className="text-base font-semibold">{providerName}</span>
        {plan && (
          <span
            data-testid="share-card-plan"
            className={cn("ml-auto rounded-full border px-2 py-1 text-xs", styles.subtext, styles.border)}
          >
            {plan}
          </span>
        )}
      </div>
      {otherLines.length > 0 && (
        <div className="flex flex-col gap-3">
          {otherLines.map((line, index) => {
            if (line.type === "progress") {
              if (!hasProgressValues(line)) return null
              return <ProgressRow key={`${line.label}-${index}`} line={line} styles={styles} brandColor={brandColor} />
            }
            if (line.type === "text") {
              return (
                <TextRow
                  key={`${line.label}-${index}`}
                  line={line}
                  styles={styles}
                  showTokens={showTokens}
                />
              )
            }
            if (line.type === "barChart") {
              return <BarChartRow key={`${line.label}-${index}`} line={line} styles={styles} brandColor={brandColor} />
            }
            if (line.type === "badge") {
              return <BadgeRow key={`${line.label}-${index}`} line={line} styles={styles} />
            }
            return null
          })}
        </div>
      )}
      {modelRows.length > 0 && (
        <div data-testid="share-card-models-section">
          <ModelBreakdownTable rows={modelRows} styles={styles} modelDisplay={displayOptions} />
        </div>
      )}
      </div>
      {showWatermark && <ShareWatermark subtextClassName={styles.subtext} />}
    </div>
  )
}
