import { CircleCheck } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StepShell } from "@/components/onboarding/step-shell"

type DoneStepProps = {
  alertsEnabled: number
  startOnLogin: boolean
  onFinish: (openSettings: boolean) => void
  busyAction: "settings" | "finish" | null
}

export function DoneStep({ alertsEnabled, startOnLogin, onFinish, busyAction }: DoneStepProps) {
  const summary = [
    alertsEnabled > 0
      ? `${alertsEnabled} alert${alertsEnabled === 1 ? "" : "s"} on`
      : "Alerts off",
    startOnLogin ? "starts at login" : "manual start",
  ].join(" · ")

  return (
    <StepShell
      title="You're all set"
      description="UsagePal now lives in your menu bar, keeping your usage one glance away."
      actions={
        <>
          <Button size="lg" onClick={() => onFinish(false)} disabled={busyAction !== null}>
            Open UsagePal
          </Button>
          <Button size="lg" variant="ghost" onClick={() => onFinish(true)} disabled={busyAction !== null}>
            Open Settings
          </Button>
        </>
      }
    >
      <div className="flex h-full flex-col items-center justify-center gap-3 py-6">
        <CircleCheck className="size-14 text-primary animate-in zoom-in-50 fade-in duration-500" aria-hidden />
        <p className="text-sm text-muted-foreground">{summary}</p>
      </div>
    </StepShell>
  )
}
