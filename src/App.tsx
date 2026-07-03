import { isTauri } from "@tauri-apps/api/core"
import { getCurrentWindow } from "@tauri-apps/api/window"
import { MainApp } from "@/components/app/main-app"
import { ShareWindowApp } from "@/components/app/share-window-app"
import { SHARE_WINDOW_LABEL } from "@/lib/share-window"

function App() {
  const label = isTauri() ? getCurrentWindow().label : undefined
  if (label === SHARE_WINDOW_LABEL) {
    return <ShareWindowApp />
  }
  return <MainApp />
}

export { App }
