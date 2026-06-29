import { useEffect, useState } from "react"

/**
 * Returns true if the app is currently in dark mode.
 * Checks the actual `dark` class on documentElement, which respects the app's
 * theme setting (light/dark/system) rather than only the system preference.
 */
export function useDarkMode(): boolean {
  const [isDark, setIsDark] = useState(
    () => typeof document !== "undefined" && document.documentElement.classList.contains("dark")
  )

  useEffect(() => {
    if (typeof document === "undefined") return
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains("dark"))
    })
    observer.observe(root, { attributes: true, attributeFilter: ["class"] })
    // Sync initial state in case it changed between render and effect
    setIsDark(root.classList.contains("dark"))
    return () => observer.disconnect()
  }, [])

  return isDark
}
