import { useState } from "react"
import { EyeSlash } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { MenubarPreviewRow } from "@/components/onboarding/menubar-preview"
import { StepShell } from "@/components/onboarding/step-shell"
import { cn } from "@/lib/utils"

type LoginStepProps = {
  onContinue: (startOnLogin: boolean) => void
  busy: boolean
  /** Orchestrator-provided Back button, rendered left of Continue. */
  backButton?: React.ReactNode
}

export function LoginStep({ onContinue, busy, backButton }: LoginStepProps) {
  const [enabled, setEnabled] = useState(true)

  return (
    <StepShell
      title="Start when you sign in"
      description="Launch UsagePal quietly with macOS so your menu-bar usage is ready before you need it."
      actions={
        <>
          {backButton}
          <Button size="sm" onClick={() => onContinue(enabled)} disabled={busy}>
            Continue
          </Button>
        </>
      }
    >
      <div className="mx-auto w-full max-w-sm space-y-4">
        <MenubarPreviewRow dimmed={!enabled} />

        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <EyeSlash className="size-4 shrink-0 text-primary" aria-hidden />
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
