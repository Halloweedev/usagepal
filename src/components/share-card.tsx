import type { MetricLine } from "@/lib/plugin-types"
import { cn, clamp01, formatCountNumber } from "@/lib/utils"

export type ShareCardTheme = "dark" | "light"

export type ShareCardProps = {
  providerName: string
  providerIconUrl: string
  brandColor?: string
  lines: MetricLine[]
  theme: ShareCardTheme
  showWatermark: boolean
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
      <div className="flex items-center justify-between text-sm">
        <span>{line.label}</span>
        <span className={styles.subtext}>{progressValueLabel(line, percent)}</span>
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
    <div data-testid="share-card-line-text" className="flex items-center justify-between text-sm">
      <span>{line.label}</span>
      <span>{line.value}</span>
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
      <div className="flex h-10 items-end gap-px">
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
  lines,
  theme,
  showWatermark,
}: ShareCardProps) {
  const styles = THEME_STYLES[theme]

  return (
    <div
      data-testid="share-card"
      className={cn("flex w-[320px] flex-col gap-4 rounded-xl border p-5", styles.bg, styles.text, styles.border)}
    >
      <div className="flex items-center gap-2">
        <img src={providerIconUrl} alt="" className="size-6" />
        <span className="text-base font-semibold">{providerName}</span>
      </div>
      <div className="flex flex-col gap-3">
        {lines.map((line, index) => {
          if (line.type === "progress") {
            return <ProgressRow key={`${line.label}-${index}`} line={line} styles={styles} brandColor={brandColor} />
          }
          if (line.type === "text") {
            return <TextRow key={`${line.label}-${index}`} line={line} />
          }
          if (line.type === "barChart") {
            return <BarChartRow key={`${line.label}-${index}`} line={line} styles={styles} brandColor={brandColor} />
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
