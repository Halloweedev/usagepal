// src/components/onboarding/onboarding-app.tsx
import { useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { CaretLeft } from "@phosphor-icons/react"

import { syncAutostart } from "@/lib/autostart"

import { ChromelessWindowShell } from "@/components/chromeless-window-shell"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { PACE_MILESTONES } from "@/lib/pace-notifications"
import {
  loadPluginSettings,
  mergeProviderSelection,
  savePaceNotificationSettings,
  savePluginSettings,
  saveStartOnLogin,
  type PaceNotificationSettings,
} from "@/lib/settings"
import { WelcomeStep } from "@/components/onboarding/steps/welcome-step"
import { TourStep } from "@/components/onboarding/steps/tour-step"
import { NotificationsStep } from "@/components/onboarding/steps/notifications-step"
import { LoginStep } from "@/components/onboarding/steps/login-step"
import { DoneStep, type ProviderSelection } from "@/components/onboarding/steps/done-step"

const steps = ["welcome", "tour", "notifications", "login", "done"] as const
type Step = (typeof steps)[number]
type BusyAction = "notifications" | "login" | "settings" | "finish" | null

const stepIndex = (step: Step) => steps.indexOf(step)

function OnboardingApp() {
  const [step, setStep] = useState<Step>("welcome")
  const [direction, setDirection] = useState<"forward" | "back">("forward")
  const [busyAction, setBusyAction] = useState<BusyAction>(null)
  // Summary for the done step: what the user actually ended up with.
  const [alertsEnabled, setAlertsEnabled] = useState(0)
  const [startOnLogin, setStartOnLogin] = useState(false)

  const goTo = (target: Step) => {
    setDirection(stepIndex(target) >= stepIndex(step) ? "forward" : "back")
    setStep(target)
  }
  const next = () => goTo(steps[Math.min(stepIndex(step) + 1, steps.length - 1)])
  const back = () => goTo(steps[Math.max(stepIndex(step) - 1, 0)])

  async function enableNotifications(selection: PaceNotificationSettings) {
    setBusyAction("notifications")
    try {
      const result = await invoke<string>("request_notification_permission")
      const normalized = String(result).toLowerCase()
      if (normalized.includes("granted") || normalized.includes("allow")) {
        await savePaceNotificationSettings(selection)
        setAlertsEnabled(PACE_MILESTONES.filter((key) => selection[key]).length)
      }
    } catch (error) {
      console.error("Failed to request notification permission:", error)
    } finally {
      setBusyAction(null)
      next()
    }
  }

  async function applyStartOnLogin(value: boolean) {
    setBusyAction("login")
    try {
      await saveStartOnLogin(value)
      await syncAutostart(value)
      setStartOnLogin(value)
    } catch (error) {
      console.error("Failed to apply start at login:", error)
    } finally {
      setBusyAction(null)
      next()
    }
  }

  async function finish(openSettings: boolean, selection?: ProviderSelection) {
    setBusyAction(openSettings ? "settings" : "finish")
    // A failed selection save logs and never blocks finishing, same as autostart.
    if (selection && (selection.keep.length > 0 || selection.drop.length > 0)) {
      try {
        const current = await loadPluginSettings()
        await savePluginSettings(mergeProviderSelection(current, selection.keep, selection.drop))
      } catch (error) {
        console.error("Failed to save provider selection:", error)
      }
    }
    try {
      if (isTauri()) await invoke("finish_onboarding", { openSettings })
    } catch (error) {
      console.error("Failed to finish onboarding:", error)
    } finally {
      setBusyAction(null)
    }
  }

  // Footer Back button, rendered by the steps left of their primary action.
  const backButton =
    step !== "welcome" && step !== "done" && busyAction === null ? (
      <Button size="sm" variant="outline" onClick={back}>
        <CaretLeft className="size-4" aria-hidden />
        Back
      </Button>
    ) : undefined

  // The setup window is undecorated; Escape dismisses like "Skip setup" —
  // finish without extras and open the app.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void finish(false)
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ChromelessWindowShell
      headerRight={
        <div
          className="flex w-28 gap-1.5"
          aria-label={`Step ${stepIndex(step) + 1} of ${steps.length}`}
        >
          {steps.map((item) => (
            <span
              key={item}
              className={cn(
                "h-1.5 flex-1 rounded-full bg-border transition-colors duration-500",
                stepIndex(item) <= stepIndex(step) && "bg-primary"
              )}
            />
          ))}
        </div>
      }
    >
      <div
        key={step}
        className={cn(
          "h-full animate-in fade-in duration-300",
          direction === "forward" ? "slide-in-from-right-8" : "slide-in-from-left-8"
        )}
      >
        {step === "welcome" && (
          <WelcomeStep onContinue={next} onSkip={() => finish(false)} skipBusy={busyAction === "finish"} />
        )}
        {step === "tour" && <TourStep onContinue={next} backButton={backButton} />}
        {step === "notifications" && (
          <NotificationsStep
            onEnable={enableNotifications}
            onSkip={next}
            busy={busyAction === "notifications"}
            backButton={backButton}
          />
        )}
        {step === "login" && (
          <LoginStep
            onContinue={applyStartOnLogin}
            busy={busyAction === "login"}
            backButton={backButton}
          />
        )}
        {step === "done" && (
          <DoneStep
            alertsEnabled={alertsEnabled}
            startOnLogin={startOnLogin}
            onFinish={finish}
            busy={busyAction !== null}
          />
        )}
      </div>
    </ChromelessWindowShell>
  )
}

export { OnboardingApp }
