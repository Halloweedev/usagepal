import { Fragment } from "react"
import type { MetricLine } from "@/lib/plugin-types"
import type { ModelBreakdownParsed, ModelDisplayOptions } from "@/lib/model-breakdown-format"
import { parseModelBreakdownValue } from "@/lib/model-breakdown-format"
import { cn, clamp01, formatCountNumber } from "@/lib/utils"
import { ShareWatermark } from "@/components/share-watermark"
import { ProviderIconMask } from "@/components/provider-icon-mask"

type ProgressMetricLine = Extract<MetricLine, { type: "progress" }> & { used: number; limit: number }
type UsableBarChartPoint = Extract<MetricLine, { type: "barChart" }>["points"][number] & { value: number }

function hasProgressValues(line: Extract<MetricLine, { type: "progress" }>): line is ProgressMetricLine {
  return line.used != null && line.limit != null
}

export type ShareCardTheme = "dark" | "light"

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
}

type ThemeStyle = {
  frame: string
  bg: string
  text: string
  subtext: string
  track: string
  border: string
}

const THEME_STYLES: Record<ShareCardTheme, ThemeStyle> = {
  dark: {
    frame: "bg-neutral-900",
    bg: "bg-neutral-950",
    text: "text-white",
    subtext: "text-white/60",
    track: "bg-white/10",
    border: "border-white/10",
  },
  light: {
    frame: "bg-neutral-100",
    bg: "bg-white",
    text: "text-neutral-900",
    subtext: "text-neutral-500",
    track: "bg-black/10",
    border: "border-black/10",
  },
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

function TextRow({ line }: { line: Extract<MetricLine, { type: "text" }> }) {
  return (
    <div data-testid="share-card-line-text" className="flex items-center justify-between">
      <span className="text-sm">{line.label}</span>
      <span className="text-xs">{line.value}</span>
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
    modelDisplay.showToday && { key: "today", header: "Today", value: (parsed: ModelBreakdownParsed) => parsed.today },
    modelDisplay.showSevenDay && { key: "sevenDay", header: "7d", value: (parsed: ModelBreakdownParsed) => parsed.sevenDay },
    modelDisplay.showThirtyDay && { key: "thirtyDay", header: "30d", value: (parsed: ModelBreakdownParsed) => parsed.thirtyDay },
  ].filter((column): column is ModelColumn => Boolean(column))

  return (
    <div
      data-testid="share-card-models"
      className="grid items-baseline gap-x-3 gap-y-1.5"
      style={{ gridTemplateColumns: `minmax(0, 1fr) repeat(${columns.length}, max-content)` }}
    >
      <span className={cn("text-[10px] font-medium uppercase tracking-wider", styles.subtext)}>Model</span>
      {columns.map((column) => (
        <span
          key={column.key}
          className={cn("text-right text-[10px] font-medium uppercase tracking-wider", styles.subtext)}
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
              return <TextRow key={`${line.label}-${index}`} line={line} />
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
