import { useEffect, useState } from "react"
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
  /** How long each selected alert stays in the banner preview rotation. */
  previewCycleMs?: number
}

export function NotificationsStep({
  onEnable,
  onSkip,
  busy,
  previewCycleMs = 2000,
}: NotificationsStepProps) {
  const [selection, setSelection] = useState<PaceNotificationSettings>(
    ONBOARDING_PACE_NOTIFICATION_SETTINGS
  )
  const [preview, setPreview] = useState<PaceMilestone>("closeToRunningOut")

  const toggle = (key: PaceMilestone, checked: boolean) => {
    const next = { ...selection, [key]: checked }
    setSelection(next)
    if (checked) {
      setPreview(key)
    } else if (preview === key) {
      const remaining = PACE_MILESTONES.filter((milestone) => next[milestone])
      if (remaining.length > 0) setPreview(remaining[0])
    }
  }

  // With several alerts selected, rotate the banner through all of them so the
  // user sees each one's copy. Toggling restarts the rotation from that alert.
  useEffect(() => {
    const enabled = PACE_MILESTONES.filter((key) => selection[key])
    if (enabled.length < 2) return
    const timer = window.setInterval(() => {
      setPreview((current) => {
        const index = enabled.indexOf(current)
        return enabled[(index + 1) % enabled.length]
      })
    }, previewCycleMs)
    return () => window.clearInterval(timer)
  }, [selection, preview, previewCycleMs])

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
