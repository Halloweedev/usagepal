import { useEffect, useState } from "react"
import { isTauri } from "@tauri-apps/api/core"
import {
  isPermissionGranted,
  requestPermission,
} from "@tauri-apps/plugin-notification"
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
  const [permissionDenied, setPermissionDenied] = useState(false)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const handleToggle = async (key: keyof PaceNotificationSettings, checked: boolean) => {
    setToggle(key, checked)
    // Request permission the first time any trigger is turned on. The toggle stays set even if denied,
    // and the evaluation simply won't deliver until permission is granted.
    if (checked && isTauri()) {
      const granted = await ensureNotificationPermission()
      setPermissionDenied(!granted)
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
                onCheckedChange={(checked) => void handleToggle(key, checked === true)}
              />
              {meta.label}
            </label>
          )
        })}
      </div>
      {permissionDenied && (
        <p className="text-sm text-muted-foreground mt-2">
          Notifications are blocked. Enable them for UsagePal in System Settings › Notifications.
        </p>
      )}
    </section>
  )
}
