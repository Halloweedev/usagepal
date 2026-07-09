import { useEffect, useState } from "react"
import { Sparkles, SquareTerminal } from "lucide-react"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { ProviderCard } from "@/components/provider-card"
import { StepShell } from "@/components/onboarding/step-shell"
import { makeMockClaudeLines } from "@/components/onboarding/mock-data"

const LINE_REVEAL_INTERVAL_MS = 350

/** The menu-bar icon styles UsagePal offers, cycled in the welcome miniature:
 * single provider with percent, donut, compact bars, and the multi-provider
 * row in its percent and bars variants. */
const MENUBAR_VARIANTS = ["percent", "donut", "bars", "multi-percent", "multi-bars"] as const
type MenubarVariant = (typeof MENUBAR_VARIANTS)[number]

const MENUBAR_VARIANT_LABELS: Record<MenubarVariant, string> = {
  percent: "One provider · percent",
  donut: "One provider · donut",
  bars: "One provider · bars",
  "multi-percent": "Several providers · percent",
  "multi-bars": "Several providers · bars",
}

type WelcomeStepProps = {
  onContinue: () => void
  onSkip: () => void
  skipBusy: boolean
  /** How long each menu-bar style stays visible in the cycling preview. */
  menubarCycleMs?: number
}

export function WelcomeStep({ onContinue, onSkip, skipBusy, menubarCycleMs = 1800 }: WelcomeStepProps) {
  const [lines] = useState(() => makeMockClaudeLines())
  const [visibleCount, setVisibleCount] = useState(0)
  const [variantIndex, setVariantIndex] = useState(0)
  const variant = MENUBAR_VARIANTS[variantIndex]

  // Reveal the mock panel lines one at a time so the miniature "loads in".
  useEffect(() => {
    if (visibleCount >= lines.length) return
    const timer = setTimeout(() => setVisibleCount((count) => count + 1), LINE_REVEAL_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [visibleCount, lines.length])

  useEffect(() => {
    const timer = window.setInterval(
      () => setVariantIndex((index) => (index + 1) % MENUBAR_VARIANTS.length),
      menubarCycleMs
    )
    return () => window.clearInterval(timer)
  }, [menubarCycleMs])

  return (
    <StepShell
      title="Welcome to UsagePal"
      description="UsagePal lives in your menu bar and keeps your AI usage one glance away. Here's what it looks like."
      actions={
        <>
          <Button size="lg" onClick={onContinue} disabled={skipBusy}>
            Continue
          </Button>
          <Button size="lg" variant="ghost" onClick={onSkip} disabled={skipBusy}>
            Skip setup
          </Button>
        </>
      }
    >
      <div className="mx-auto w-full max-w-sm space-y-3">
        <div>
          <div className="flex items-center justify-end gap-3 rounded-lg border bg-muted/60 px-3 py-1.5">
            <span
              data-testid="menubar-preview"
              data-variant={variant}
              className="flex h-5 items-center rounded-md bg-background px-2 shadow-sm"
            >
              <span key={variant} className="flex items-center gap-1.5 text-xs font-medium animate-in fade-in duration-300">
                <MenubarIconPreview variant={variant} />
              </span>
            </span>
            <span className="text-xs text-muted-foreground tabular-nums">Wed 9:41 AM</span>
          </div>
          <p key={variant} className="mt-1.5 text-center text-[11px] text-muted-foreground animate-in fade-in duration-300">
            {MENUBAR_VARIANT_LABELS[variant]} — pick your style in Settings
          </p>
        </div>
        <div className="rounded-2xl border bg-card px-4 py-1 shadow-md">
          <ProviderCard
            name="Claude"
            plan="Max"
            showSeparator={false}
            lines={lines.slice(0, visibleCount)}
            skeletonLines={[]}
            displayMode="left"
            resetTimerDisplayMode="relative"
          />
        </div>
      </div>
    </StepShell>
  )
}

function MenubarIconPreview({ variant }: { variant: MenubarVariant }) {
  switch (variant) {
    case "percent":
      return (
        <>
          <Logo className="size-3.5" aria-hidden />
          68%
        </>
      )
    case "donut":
      return (
        <>
          <Logo className="size-3.5" aria-hidden />
          <MiniDonut fraction={0.68} />
        </>
      )
    case "bars":
      return (
        <>
          <Logo className="size-3.5" aria-hidden />
          <MiniBars session={0.68} weekly={0.39} />
        </>
      )
    case "multi-percent":
      return (
        <>
          <Logo className="size-3.5" aria-hidden />
          68%
          <Sparkles className="size-3.5" aria-hidden />
          42%
          <SquareTerminal className="size-3.5" aria-hidden />
          91%
        </>
      )
    case "multi-bars":
      return (
        <>
          <Logo className="size-3.5" aria-hidden />
          <MiniBars session={0.68} weekly={0.39} />
          <Sparkles className="size-3.5" aria-hidden />
          <MiniBars session={0.42} weekly={0.8} />
          <SquareTerminal className="size-3.5" aria-hidden />
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
