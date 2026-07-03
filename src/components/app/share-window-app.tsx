import { useEffect, useState } from "react"
import { SharePage } from "@/pages/share"
import { useShareWindowData } from "@/hooks/app/use-share-window-data"
import { useShareWindowResize } from "@/hooks/app/use-share-window-resize"
import { useSettingsTheme } from "@/hooks/app/use-settings-theme"
import { DEFAULT_THEME_MODE, loadThemeMode, type ThemeMode } from "@/lib/settings"

/**
 * Root component rendered in the dedicated "share" pop-out window. It owns no
 * probe loop; plugin data arrives from the main window via events. Layout is a
 * simple padded card — no SideNav, no PanelFooter.
 */
export function ShareWindowApp() {
  const plugins = useShareWindowData()
  const [themeMode, setThemeMode] = useState<ThemeMode>(DEFAULT_THEME_MODE)
  const { containerRef, maxContentHeightPx } = useShareWindowResize()

  useEffect(() => {
    loadThemeMode()
      .then(setThemeMode)
      .catch((error) => {
        console.error("Failed to load theme mode:", error)
      })
  }, [])

  useSettingsTheme(themeMode)

  return (
    <div ref={containerRef} className="bg-background p-6" data-testid="share-window-root">
      <div
        className="rounded-xl border bg-card p-6 shadow-sm"
        style={
          maxContentHeightPx
            ? { maxHeight: `${maxContentHeightPx}px`, overflowY: "auto" }
            : undefined
        }
      >
        <SharePage plugins={plugins} />
      </div>
    </div>
  )
}
