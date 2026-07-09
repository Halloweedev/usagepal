import { BellOff, BellRing, CircleCheck, Power } from "lucide-react"
import { Button } from "@/components/ui/button"
import { StepShell } from "@/components/onboarding/step-shell"
import { cn } from "@/lib/utils"

type DoneStepProps = {
  alertsEnabled: number
  startOnLogin: boolean
  onFinish: (openSettings: boolean) => void
  busyAction: "settings" | "finish" | null
}

export function DoneStep({ alertsEnabled, startOnLogin, onFinish, busyAction }: DoneStepProps) {
  const alertsText =
    alertsEnabled > 0 ? `${alertsEnabled} alert${alertsEnabled === 1 ? "" : "s"} on` : "Alerts off"
  const loginText = startOnLogin ? "Starts when you sign in" : "Starts only when you open it"

  return (
    <StepShell
      title="You're all set"
      description="UsagePal now lives in your menu bar, keeping your usage one glance away."
      actions={
        <Button size="lg" onClick={() => onFinish(false)} disabled={busyAction !== null}>
          Open UsagePal
        </Button>
      }
      secondaryAction={
        <Button size="lg" variant="ghost" onClick={() => onFinish(true)} disabled={busyAction !== null}>
          Open Settings
        </Button>
      }
    >
      <div className="flex h-full flex-col items-center justify-center gap-5 py-6">
        <CircleCheck className="size-14 text-primary animate-in zoom-in-50 fade-in duration-500" aria-hidden />
        <div
          className="w-full max-w-[280px] overflow-hidden rounded-2xl border bg-card text-sm shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500"
          style={{ animationDelay: "150ms", animationFillMode: "both" }}
        >
          <div className="flex items-center gap-2.5 px-4 py-2.5">
            {alertsEnabled > 0 ? (
              <BellRing className="size-4 shrink-0 text-primary" aria-hidden />
            ) : (
              <BellOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <span className={cn(alertsEnabled > 0 ? "text-foreground" : "text-muted-foreground")}>
              {alertsText}
            </span>
          </div>
          <div className="flex items-center gap-2.5 border-t px-4 py-2.5">
            <Power
              className={cn("size-4 shrink-0", startOnLogin ? "text-primary" : "text-muted-foreground")}
              aria-hidden
            />
            <span className={cn(startOnLogin ? "text-foreground" : "text-muted-foreground")}>
              {loginText}
            </span>
          </div>
        </div>
      </div>
    </StepShell>
  )
}
