import { useEffect, useRef, useState } from "react"
import { Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProviderCard } from "@/components/provider-card"
import { StepShell } from "@/components/onboarding/step-shell"
import { makeMockCodexLines } from "@/components/onboarding/mock-data"
import { cn } from "@/lib/utils"
import type { ResetTimerDisplayMode } from "@/lib/settings"

const HOVER_DWELL_MS = 400

type TourStepProps = {
  onContinue: () => void
}

export function TourStep({ onContinue }: TourStepProps) {
  const [lines] = useState(() => makeMockCodexLines())
  const [hoverDone, setHoverDone] = useState(false)
  const [clickDone, setClickDone] = useState(false)
  const [resetMode, setResetMode] = useState<ResetTimerDisplayMode>("relative")
  const dwellTimer = useRef<number | null>(null)

  const cancelDwell = () => {
    if (dwellTimer.current !== null) {
      window.clearTimeout(dwellTimer.current)
      dwellTimer.current = null
    }
  }

  const startDwell = () => {
    if (hoverDone || dwellTimer.current !== null) return
    dwellTimer.current = window.setTimeout(() => {
      dwellTimer.current = null
      setHoverDone(true)
    }, HOVER_DWELL_MS)
  }

  useEffect(() => cancelDwell, [])

  const allDone = hoverDone && clickDone

  return (
    <StepShell
      title="Try it for yourself"
      description="This is a live provider view with sample data. Two quick gestures show how UsagePal works."
      actions={
        <>
          <Button size="lg" onClick={onContinue} disabled={!allDone}>
            Continue
          </Button>
          {!allDone && (
            <Button size="lg" variant="ghost" onClick={onContinue}>
              Skip tour
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <TourTask
            testId="tour-task-hover"
            done={hoverDone}
            label="Hover the card to peek at pace and expiry details"
          />
          <TourTask
            testId="tour-task-click"
            done={clickDone}
            label="Click the reset time to flip countdown and exact time"
          />
        </div>
        <div
          data-testid="tour-card"
          onPointerEnter={startDwell}
          onPointerLeave={cancelDwell}
          className="mx-auto w-full max-w-sm rounded-2xl border bg-card px-4 py-1 shadow-md"
        >
          <ProviderCard
            name="Codex"
            plan="Plus"
            showSeparator={false}
            lines={lines}
            skeletonLines={[]}
            displayMode="left"
            resetTimerDisplayMode={resetMode}
            onResetTimerDisplayModeToggle={() => {
              setResetMode((mode) => (mode === "relative" ? "absolute" : "relative"))
              setClickDone(true)
            }}
          />
        </div>
      </div>
    </StepShell>
  )
}

function TourTask({ testId, done, label }: { testId: string; done: boolean; label: string }) {
  return (
    <div data-testid={testId} data-done={done} className="flex items-center gap-2.5 text-sm">
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          done ? "border-primary bg-primary text-primary-foreground" : "text-transparent"
        )}
      >
        {done && <Check className="size-3 animate-in zoom-in-50 duration-300" aria-hidden />}
      </span>
      <span className={cn(done ? "text-muted-foreground line-through" : "text-foreground")}>
        {label}
      </span>
    </div>
  )
}
