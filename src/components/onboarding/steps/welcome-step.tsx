import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { ProviderCard } from "@/components/provider-card"
import { MenubarPreviewRow } from "@/components/onboarding/menubar-preview"
import { StepShell } from "@/components/onboarding/step-shell"
import { makeMockClaudeLines } from "@/components/onboarding/mock-data"

const LINE_REVEAL_INTERVAL_MS = 350

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

  // Reveal the mock panel lines one at a time so the miniature "loads in".
  useEffect(() => {
    if (visibleCount >= lines.length) return
    const timer = setTimeout(() => setVisibleCount((count) => count + 1), LINE_REVEAL_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [visibleCount, lines.length])

  return (
    <StepShell
      title="Welcome to UsagePal"
      description="UsagePal lives in your menu bar and keeps your AI usage one glance away. Here's what it looks like."
      actions={
        <Button size="sm" onClick={onContinue} disabled={skipBusy}>
          Continue
        </Button>
      }
      secondaryAction={
        <Button size="sm" variant="ghost" onClick={onSkip} disabled={skipBusy}>
          Skip setup
        </Button>
      }
    >
      <div className="mx-auto w-full max-w-sm space-y-3">
        <MenubarPreviewRow cycleMs={menubarCycleMs} />
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
