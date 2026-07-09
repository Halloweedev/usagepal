import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { Check, MousePointerClick } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ProviderCard } from "@/components/provider-card"
import { StepShell } from "@/components/onboarding/step-shell"
import { makeMockCodexLines } from "@/components/onboarding/mock-data"
import { cn } from "@/lib/utils"
import type { DisplayMode, ResetTimerDisplayMode } from "@/lib/settings"

/** The four guided gestures, in the order the spotlight walks through them.
 * Completion is accepted in any order; the spotlight always points at the
 * first task still pending. */
const TOUR_TASKS = ["hover-reset", "click-reset", "hover-flame", "flip-usage"] as const
type TourTaskId = (typeof TOUR_TASKS)[number]

const TASK_LABELS: Record<TourTaskId, string> = {
  "hover-reset": "Hover the reset time to peek at the exact moment",
  "click-reset": "Click the reset time to flip countdown and exact time",
  "hover-flame": "Hover the flame to see why this limit runs hot",
  "flip-usage": "Click a usage value to switch between left and used",
}

type TourStepProps = {
  onContinue: () => void
  /** Pointer detection stays disarmed this long after mount so the step
   * transition can't complete a task with a resting cursor. */
  armDelayMs?: number
  hoverDwellMs?: number
}

export function TourStep({ onContinue, armDelayMs = 600, hoverDwellMs = 400 }: TourStepProps) {
  const [lines] = useState(() => makeMockCodexLines())
  const [done, setDone] = useState<Record<TourTaskId, boolean>>({
    "hover-reset": false,
    "click-reset": false,
    "hover-flame": false,
    "flip-usage": false,
  })
  const [resetMode, setResetMode] = useState<ResetTimerDisplayMode>("relative")
  const [displayMode, setDisplayMode] = useState<DisplayMode>("left")
  const [armed, setArmed] = useState(armDelayMs === 0)
  const [spot, setSpot] = useState<{ top: number; left: number; width: number; height: number } | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const dwellTimers = useRef<Partial<Record<TourTaskId, number>>>({})

  const complete = useCallback((task: TourTaskId) => {
    setDone((current) => (current[task] ? current : { ...current, [task]: true }))
  }, [])

  useEffect(() => {
    if (armDelayMs === 0) return
    const timer = window.setTimeout(() => setArmed(true), armDelayMs)
    return () => window.clearTimeout(timer)
  }, [armDelayMs])

  useEffect(() => {
    const timers = dwellTimers.current
    return () => {
      for (const timer of Object.values(timers)) window.clearTimeout(timer)
    }
  }, [])

  const activeTask = TOUR_TASKS.find((task) => !done[task]) ?? null
  const allDone = activeTask === null

  // The reset button and flame live inside ProviderCard, so hover tasks are
  // detected by delegation on the card wrapper rather than direct handlers.
  const hoverTargetFor = (element: Element): TourTaskId | null => {
    const button = element.closest("button")
    if (button && /^Resets/.test(button.textContent ?? "")) return "hover-reset"
    const flame = element.closest('span[aria-label="Will run out"]')
    if (flame) return "hover-flame"
    return null
  }

  const handlePointerOver = (event: React.PointerEvent) => {
    if (!armed) return
    const task = hoverTargetFor(event.target as Element)
    if (!task || done[task] || dwellTimers.current[task] !== undefined) return
    dwellTimers.current[task] = window.setTimeout(() => {
      delete dwellTimers.current[task]
      complete(task)
    }, hoverDwellMs)
  }

  const handlePointerOut = (event: React.PointerEvent) => {
    const task = hoverTargetFor(event.target as Element)
    if (!task) return
    const timer = dwellTimers.current[task]
    if (timer !== undefined) {
      window.clearTimeout(timer)
      delete dwellTimers.current[task]
    }
  }

  // Spotlight ring over the active task's target, positioned relative to the
  // card wrapper. Recomputed when the target or the card's rendered text changes.
  useLayoutEffect(() => {
    const root = cardRef.current
    if (!root || !activeTask) {
      setSpot(null)
      return
    }
    const findTarget = (): Element | null => {
      switch (activeTask) {
        case "hover-reset":
        case "click-reset": {
          const buttons = Array.from(root.querySelectorAll("button"))
          return buttons.find((button) => /^Resets/.test(button.textContent ?? "")) ?? null
        }
        case "hover-flame":
          return root.querySelector('span[aria-label="Will run out"]')
        case "flip-usage":
          return root.querySelector("[data-usage-toggle]")
      }
    }
    const update = () => {
      const target = findTarget()
      const rootRect = root.getBoundingClientRect()
      const rect = target?.getBoundingClientRect()
      if (!rect || rect.width === 0) {
        setSpot(null)
        return
      }
      setSpot({
        top: rect.top - rootRect.top - 4,
        left: rect.left - rootRect.left - 6,
        width: rect.width + 12,
        height: rect.height + 8,
      })
    }
    update()
    window.addEventListener("resize", update)
    return () => window.removeEventListener("resize", update)
  }, [activeTask, resetMode, displayMode])

  return (
    <StepShell
      title="Try it for yourself"
      description="This is a live provider view with sample data — everything on it works. Follow the highlight."
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
        <div className="space-y-1.5">
          {TOUR_TASKS.map((task) => (
            <TourTask
              key={task}
              testId={`tour-task-${task}`}
              done={done[task]}
              active={task === activeTask}
              label={TASK_LABELS[task]}
            />
          ))}
        </div>
        <div
          ref={cardRef}
          data-testid="tour-card"
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
          className="relative mx-auto w-full max-w-sm rounded-2xl border bg-card px-4 py-1 shadow-md"
        >
          <ProviderCard
            name="Codex"
            plan="Plus"
            showSeparator={false}
            lines={lines}
            skeletonLines={[]}
            displayMode={displayMode}
            resetTimerDisplayMode={resetMode}
            onResetTimerDisplayModeToggle={() => {
              setResetMode((mode) => (mode === "relative" ? "absolute" : "relative"))
              if (armed) complete("click-reset")
            }}
            onUsageValueToggle={() => {
              setDisplayMode((mode) => (mode === "left" ? "used" : "left"))
              if (armed) complete("flip-usage")
            }}
          />
          {spot && (
            <div
              aria-hidden
              className="pointer-events-none absolute rounded-lg ring-2 ring-primary/70 animate-pulse"
              style={spot}
            />
          )}
        </div>
      </div>
    </StepShell>
  )
}

function TourTask({
  testId,
  done,
  active,
  label,
}: {
  testId: string
  done: boolean
  active: boolean
  label: string
}) {
  return (
    <div data-testid={testId} data-done={done} className="flex items-center gap-2.5 text-sm">
      <span
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
          done
            ? "border-primary bg-primary text-primary-foreground"
            : active
              ? "border-primary text-primary"
              : "text-transparent"
        )}
      >
        {done ? (
          <Check className="size-3 animate-in zoom-in-50 duration-300" aria-hidden />
        ) : active ? (
          <MousePointerClick className="size-3 animate-pulse" aria-hidden />
        ) : null}
      </span>
      <span
        className={cn(
          done
            ? "text-muted-foreground line-through"
            : active
              ? "font-medium text-foreground"
              : "text-muted-foreground"
        )}
      >
        {label}
      </span>
    </div>
  )
}
