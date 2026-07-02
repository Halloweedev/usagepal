import { useEffect, useRef, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { MILESTONE_META, PACE_MILESTONES } from "@/lib/pace-notifications"
import type { PaceNotificationSettings } from "@/lib/settings"
import { useAppNotificationsStore } from "@/stores/app-notifications-store"

// The three toggles map 1:1 onto the milestone keys, in urgency order.
const MILESTONE_KEYS: (keyof PaceNotificationSettings)[] = PACE_MILESTONES

async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if (await isPermissionGranted()) return true
    return (await requestPermission()) === "granted"
  } catch (error) {
    console.error("Failed to request notification permission:", error)
    return false
  }
}

export function NotificationsSection() {
  const settings = useAppNotificationsStore((s) => s.settings)
  const setToggle = useAppNotificationsStore((s) => s.setToggle)
  const hydrate = useAppNotificationsStore((s) => s.hydrate)
  const [testStatus, setTestStatus] = useState<"sent" | "failed" | null>(null)
  const [showPermissionModal, setShowPermissionModal] = useState(false)
  const testCount = useRef(0)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // Fire a real notification on demand so you can confirm delivery works on this Mac — pace alerts
  // only fire when a metric worsens across refreshes, which is hard to trigger by hand.
  const handleTest = async () => {
    if (!isTauri()) return
    setTestStatus(null)
    if (!(await ensureNotificationPermission())) {
      setShowPermissionModal(true)
      return
    }
    try {
      // Unique (i32-safe) id + body per click so macOS doesn't coalesce identical notifications.
      testCount.current += 1
      sendNotification({
        id: testCount.current,
        title: "UsagePal",
        body: `Test notification #${testCount.current} — alerts are working.`,
      })
      setTestStatus("sent")
    } catch (error) {
      console.error("Failed to send test notification:", error)
      setTestStatus("failed")
    }
  }

  const handleToggle = (key: keyof PaceNotificationSettings, checked: boolean) => {
    setToggle(key, checked)
    // macOS never shows a permission prompt for Tauri apps, and notifications can default to off — so
    // remind the user to allow them in System Settings when they turn a trigger on.
    if (checked && isTauri()) {
      setShowPermissionModal(true)
    }
  }

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">Notifications</h3>
      <p className="text-sm text-muted-foreground mb-2">
        Get alerted as a limit is on pace to run out
      </p>
      <div className="space-y-2">
        {MILESTONE_KEYS.map((key) => {
          const meta = MILESTONE_META[key]
          return (
            <label
              key={key}
              title={meta.tooltip}
              className="flex items-center gap-2 text-sm select-none text-foreground"
            >
              <Checkbox
                key={`notif-${key}-${settings[key]}`}
                checked={settings[key]}
                onCheckedChange={(checked) => handleToggle(key, checked === true)}
              />
              {meta.label}
            </label>
          )
        })}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void handleTest()}>
          Send Test Notification
        </Button>
        {testStatus === "sent" && (
          <span className="text-xs text-muted-foreground">Sent — check Notification Center.</span>
        )}
        {testStatus === "failed" && (
          <span className="text-xs text-muted-foreground">Couldn't send — see System Settings.</span>
        )}
      </div>

      {showPermissionModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowPermissionModal(false)
          }}
        >
          <div className="bg-card rounded-lg border shadow-xl p-5 max-w-xs w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
            <h2 className="text-base font-semibold mb-1">Allow Notifications</h2>
            <p className="text-sm text-muted-foreground mb-4">
              To get UsagePal alerts, turn on notifications for UsagePal in System Settings.
            </p>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowPermissionModal(false)}>
                Done
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={() => {
                  void invoke("open_notification_settings").catch((e) =>
                    console.error("Failed to open notification settings:", e)
                  )
                  setShowPermissionModal(false)
                }}
              >
                Open Settings
              </Button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
