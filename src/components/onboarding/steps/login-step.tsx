import { useState } from "react"
import { EyeOff } from "lucide-react"
import { Logo } from "@/components/logo"
import { Button } from "@/components/ui/button"
import { StepShell } from "@/components/onboarding/step-shell"
import { cn } from "@/lib/utils"

type LoginStepProps = {
  onContinue: (startOnLogin: boolean) => void
  busy: boolean
}

export function LoginStep({ onContinue, busy }: LoginStepProps) {
  const [enabled, setEnabled] = useState(true)

  return (
    <StepShell
      title="Start when you sign in"
      description="Launch UsagePal quietly with macOS so your menu-bar usage is ready before you need it."
      actions={
        <Button size="lg" onClick={() => onContinue(enabled)} disabled={busy}>
          Continue
        </Button>
      }
    >
      <div className="mx-auto w-full max-w-sm space-y-4">
        <div
          className={cn(
            "flex items-center justify-end gap-3 rounded-lg border px-3 py-1.5 transition-colors",
            enabled ? "bg-muted/60" : "bg-muted/20"
          )}
        >
          <span
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium transition-all",
              enabled ? "bg-background shadow-sm" : "opacity-30"
            )}
          >
            <Logo className="size-3.5" aria-hidden />
            68%
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">Wed 9:41 AM</span>
        </div>

        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <EyeOff className="size-4 shrink-0 text-primary" aria-hidden />
          <span>Starts hidden — no window, no Dock icon.</span>
        </div>

        <div className="rounded-2xl border bg-card p-2 shadow-sm">
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={() => setEnabled((value) => !value)}
            className="flex w-full items-center justify-between rounded-xl px-4 py-3 transition-colors hover:bg-muted/60"
          >
            <span className="text-sm font-medium text-foreground">Start UsagePal at login</span>
            <span
              aria-hidden
              className={cn(
                "relative h-6 w-10 shrink-0 rounded-full transition-colors",
                enabled ? "bg-primary" : "bg-border"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 left-0.5 size-5 rounded-full bg-background shadow transition-transform",
                  enabled && "translate-x-4"
                )}
              />
            </span>
          </button>
        </div>
      </div>
    </StepShell>
  )
}
