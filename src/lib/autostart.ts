import { isTauri } from "@tauri-apps/api/core"
import {
  disable as disableAutostart,
  enable as enableAutostart,
  isEnabled as isAutostartEnabled,
} from "@tauri-apps/plugin-autostart"

/** Sync the OS launch-at-login registration to `value`, skipping the native
 * call when it already matches. No-op outside Tauri. */
export async function syncAutostart(value: boolean): Promise<void> {
  if (!isTauri()) return
  if ((await isAutostartEnabled()) === value) return
  if (value) {
    await enableAutostart()
    return
  }
  await disableAutostart()
}
