import { useEffect, useState } from "react"
import claudeIconRaw from "../../../plugins/claude/icon.svg?raw"
import codexIconRaw from "../../../plugins/codex/icon.svg?raw"
import cursorIconRaw from "../../../plugins/cursor/icon.svg?raw"
import { ProviderIconMask } from "@/components/provider-icon-mask"
import { cn } from "@/lib/utils"

/** The menu-bar icon styles UsagePal offers, cycled in the preview: single
 * provider with percent, donut, compact bars, and the multi-provider row in
 * its percent and bars variants. */
const MENUBAR_VARIANTS = ["percent", "donut", "bars", "multi-percent", "multi-bars"] as const
type MenubarVariant = (typeof MENUBAR_VARIANTS)[number]

/** Inlined as data URLs so the mask images load in the setup webview the same
 * way the app's own icon_data_url does. */
const toSvgDataUrl = (raw: string) => `data:image/svg+xml;utf8,${encodeURIComponent(raw)}`
const claudeIconUrl = toSvgDataUrl(claudeIconRaw)
const codexIconUrl = toSvgDataUrl(codexIconRaw)
const cursorIconUrl = toSvgDataUrl(cursorIconRaw)

/** Real provider icons, rendered as monochrome masks like the actual tray. */
function ProviderGlyph({ iconUrl, pluginId }: { iconUrl: string; pluginId: string }) {
  return (
    <ProviderIconMask
      iconUrl={iconUrl}
      pluginId={pluginId}
      sizePx={14}
      className="bg-foreground"
      fallbackClassName="text-foreground"
    />
  )
}

type MenubarPreviewRowProps = {
  /** How long each menu-bar style stays visible. */
  cycleMs?: number
  /** Fades the pill and lightens the row, for "won't start at login" states. */
  dimmed?: boolean
}

/** The mock macOS menu bar shared by onboarding steps: a pill cycling through
 * the real icon styles next to a clock, fading in on each variant change. */
export function MenubarPreviewRow({ cycleMs = 1800, dimmed = false }: MenubarPreviewRowProps) {
  const [variantIndex, setVariantIndex] = useState(0)
  const variant = MENUBAR_VARIANTS[variantIndex]

  useEffect(() => {
    const timer = window.setInterval(
      () => setVariantIndex((index) => (index + 1) % MENUBAR_VARIANTS.length),
      cycleMs
    )
    return () => window.clearInterval(timer)
  }, [cycleMs])

  return (
    <div
      className={cn(
        "flex items-center justify-end gap-3 rounded-lg border px-3 py-1.5 transition-colors",
        dimmed ? "bg-muted/20" : "bg-muted/60"
      )}
    >
      <span
        data-testid="menubar-preview"
        data-variant={variant}
        data-dimmed={dimmed}
        className={cn(
          "flex h-5 items-center rounded-md bg-background px-2 shadow-sm transition-opacity",
          dimmed && "opacity-30"
        )}
      >
        <span key={variant} className="flex items-center gap-1.5 text-xs font-medium animate-in fade-in duration-300">
          <MenubarIconPreview variant={variant} />
        </span>
      </span>
      <span className="text-xs text-muted-foreground tabular-nums">Wed 9:41 AM</span>
    </div>
  )
}

function MenubarIconPreview({ variant }: { variant: MenubarVariant }) {
  const claude = <ProviderGlyph iconUrl={claudeIconUrl} pluginId="claude" />
  const codex = <ProviderGlyph iconUrl={codexIconUrl} pluginId="codex" />
  const cursor = <ProviderGlyph iconUrl={cursorIconUrl} pluginId="cursor" />
  switch (variant) {
    case "percent":
      return (
        <>
          {claude}
          68%
        </>
      )
    case "donut":
      return (
        <>
          {claude}
          <MiniDonut fraction={0.68} />
        </>
      )
    case "bars":
      return (
        <>
          {claude}
          <MiniBars session={0.68} weekly={0.39} />
        </>
      )
    case "multi-percent":
      return (
        <>
          {claude}
          68%
          {codex}
          42%
          {cursor}
          91%
        </>
      )
    case "multi-bars":
      return (
        <>
          {claude}
          <MiniBars session={0.68} weekly={0.39} />
          {codex}
          <MiniBars session={0.42} weekly={0.8} />
          {cursor}
          <MiniBars session={0.91} weekly={0.55} />
        </>
      )
  }
}

/** Tiny donut matching the real tray donut icon: a ring filled to the usage fraction. */
function MiniDonut({ fraction }: { fraction: number }) {
  const angle = fraction * 360
  return (
    <span
      aria-hidden
      className="size-3.5 rounded-full"
      style={{
        background: `conic-gradient(currentColor ${angle}deg, color-mix(in oklab, currentColor 25%, transparent) ${angle}deg)`,
        WebkitMask: "radial-gradient(circle, transparent 0 3.5px, #fff 4px)",
        mask: "radial-gradient(circle, transparent 0 3.5px, #fff 4px)",
      }}
    />
  )
}

/** Tiny session/weekly bar pair matching the compact-bars tray icon. */
function MiniBars({ session, weekly }: { session: number; weekly: number }) {
  return (
    <span aria-hidden className="flex w-4 flex-col gap-0.5">
      {[session, weekly].map((fraction, index) => (
        <span key={index} className="relative h-1 overflow-hidden rounded-sm bg-foreground/15">
          <span
            className="absolute inset-y-0 left-0 rounded-sm bg-foreground"
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </span>
      ))}
    </span>
  )
}
