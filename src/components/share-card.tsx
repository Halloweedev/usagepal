import type { MetricLine } from "@/lib/plugin-types"
import type { ModelDisplayOptions } from "@/lib/model-breakdown-format"
import { formatModelBreakdownValue, parseModelBreakdownValue } from "@/lib/model-breakdown-format"
import { cn, clamp01, formatCountNumber } from "@/lib/utils"

export type ShareCardTheme = "dark" | "light"

export type ShareCardProps = {
  providerName: string
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
  bg: string
  text: string
  subtext: string
  track: string
  border: string
}

const THEME_STYLES: Record<ShareCardTheme, ThemeStyle> = {
  dark: {
    bg: "bg-neutral-950",
    text: "text-white",
    subtext: "text-white/60",
    track: "bg-white/10",
    border: "border-white/10",
  },
  light: {
    bg: "bg-white",
    text: "text-neutral-900",
    subtext: "text-neutral-500",
    track: "bg-black/10",
    border: "border-black/10",
  },
}

function progressValueLabel(line: Extract<MetricLine, { type: "progress" }>, percent: number): string {
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
  line: Extract<MetricLine, { type: "progress" }>
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

function ModelBreakdownRow({
  line,
  styles,
  modelDisplay,
}: {
  line: Extract<MetricLine, { type: "text" }>
  styles: ThemeStyle
  modelDisplay: ModelDisplayOptions
}) {
  const parsed = parseModelBreakdownValue(line.value)
  const displayValue = parsed ? formatModelBreakdownValue(parsed, modelDisplay) : line.value

  return (
    <div data-testid="share-card-line-model-breakdown" className="flex flex-col gap-1">
      <span className="whitespace-nowrap text-sm">{line.label}</span>
      {displayValue && <span className={cn("text-xs", styles.subtext)}>{displayValue}</span>}
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
  const valid = line.points.filter((point) => Number.isFinite(point.value) && point.value >= 0)
  const maxValue = Math.max(1, ...valid.map((point) => point.value))

  return (
    <div data-testid="share-card-line-barchart" className="flex flex-col gap-1">
      <span className="text-sm">{line.label}</span>
      <div className="flex h-8 items-end gap-px">
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
    </div>
  )
}

export function ShareCard({
  providerName,
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

  return (
    <div
      data-testid="share-card"
      className={cn("flex w-[440px] flex-col gap-4 rounded-xl border p-5", styles.bg, styles.text, styles.border)}
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={cn("inline-block size-5", styles.text)}
          style={{
            backgroundColor: "currentColor",
            WebkitMaskImage: `url(${providerIconUrl})`,
            WebkitMaskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskImage: `url(${providerIconUrl})`,
            maskSize: "contain",
            maskRepeat: "no-repeat",
            maskPosition: "center",
          }}
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
      <div className="flex flex-col gap-3">
        {lines.map((line, index) => {
          if (line.type === "progress") {
            return <ProgressRow key={`${line.label}-${index}`} line={line} styles={styles} brandColor={brandColor} />
          }
          if (line.type === "text") {
            const isModelBreakdown = modelBreakdownLabels?.has(line.label)
            const parsed = isModelBreakdown ? parseModelBreakdownValue(line.value) : null
            if (isModelBreakdown && parsed) {
              return (
                <ModelBreakdownRow
                  key={`${line.label}-${index}`}
                  line={line}
                  styles={styles}
                  modelDisplay={displayOptions}
                />
              )
            }
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
      {showWatermark && (
        <div data-testid="share-card-watermark" className={cn("text-center text-xs", styles.subtext)}>
          Shared via UsagePal
        </div>
      )}
    </div>
  )
}
