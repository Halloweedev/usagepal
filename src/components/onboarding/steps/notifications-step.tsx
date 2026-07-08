import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { StepShell } from "@/components/onboarding/step-shell"
import { MacNotificationBanner } from "@/components/onboarding/mac-notification-banner"
import { MILESTONE_META, PACE_MILESTONES, type PaceMilestone } from "@/lib/pace-notifications"
import {
  ONBOARDING_PACE_NOTIFICATION_SETTINGS,
  type PaceNotificationSettings,
} from "@/lib/settings"

// Onboarding-only plain-language descriptions; MILESTONE_META keeps the shared labels.
const MILESTONE_DESCRIPTIONS: Record<PaceMilestone, string> = {
  underTenPercent: "When under 10% of a limit is left.",
  healthyToClose: "When you're on pace to finish close to a limit.",
  closeToRunningOut: "When you're on pace to run out before the reset.",
  sessionReset: "When a session limit is back to 0% used.",
}

type NotificationsStepProps = {
  onEnable: (selection: PaceNotificationSettings) => void
  onSkip: () => void
  busy: boolean
}

export function NotificationsStep({ onEnable, onSkip, busy }: NotificationsStepProps) {
  const [selection, setSelection] = useState<PaceNotificationSettings>(
    ONBOARDING_PACE_NOTIFICATION_SETTINGS
  )
  const [preview, setPreview] = useState<PaceMilestone>("closeToRunningOut")

  const toggle = (key: PaceMilestone, checked: boolean) => {
    setSelection((current) => ({ ...current, [key]: checked }))
    if (checked) setPreview(key)
  }

  const anySelected = PACE_MILESTONES.some((key) => selection[key])

  return (
    <StepShell
      title="Choose your alerts"
      description="UsagePal can nudge you before a limit runs out. Everything is checked locally on your Mac — nothing is sent anywhere."
      actions={
        <>
          <Button size="lg" onClick={() => onEnable(selection)} disabled={busy || !anySelected}>
            Enable notifications
          </Button>
          <Button size="lg" variant="ghost" onClick={onSkip} disabled={busy}>
            Not now
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <MacNotificationBanner key={preview} milestone={preview} />
        <div className="space-y-3">
          {PACE_MILESTONES.map((key) => (
            <label key={key} className="flex cursor-pointer items-start gap-3 select-none">
              <Checkbox
                checked={selection[key]}
                onCheckedChange={(checked) => toggle(key, checked === true)}
                className="mt-0.5"
                aria-label={`${MILESTONE_META[key].label}. ${MILESTONE_DESCRIPTIONS[key]}`}
              />
              <span>
                <span className="block text-sm font-medium text-foreground">
                  {MILESTONE_META[key].label}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {MILESTONE_DESCRIPTIONS[key]}
                </span>
              </span>
            </label>
          ))}
        </div>
      </div>
    </StepShell>
  )
}
