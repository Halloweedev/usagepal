import { useEffect, useState } from "react"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { ProviderCard } from "@/components/provider-card"
import { StepShell } from "@/components/onboarding/step-shell"
import { makeMockClaudeLines } from "@/components/onboarding/mock-data"

const LINE_REVEAL_INTERVAL_MS = 350

type WelcomeStepProps = {
  onContinue: () => void
  onSkip: () => void
  skipBusy: boolean
}

export function WelcomeStep({ onContinue, onSkip, skipBusy }: WelcomeStepProps) {
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
        <div className="flex items-center justify-end gap-3 rounded-lg border bg-muted/60 px-3 py-1.5">
          <span className="flex items-center gap-1.5 rounded-md bg-background px-2 py-0.5 text-xs font-medium shadow-sm">
            <Logo className="size-3.5" aria-hidden />
            68%
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">Wed 9:41 AM</span>
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
