import { useCallback, useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"

type KeyStatus = { saved: boolean; fromEnv: boolean }

const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys"

/**
 * Small modal for adding / clearing the OpenRouter API key, opened from the OpenRouter row in the
 * plugin list. Reuses the same Rust commands as before; the saved key is never read back into the
 * webview, so the dialog only knows whether a key is present.
 */
export function OpenRouterKeyDialog({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<KeyStatus>({ saved: false, fromEnv: false })
  const [keyInput, setKeyInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    if (!isTauri()) return
    try {
      const result = await invoke<KeyStatus>("openrouter_key_status")
      if (result && typeof result === "object") setStatus(result)
    } catch (e) {
      console.error("Failed to read OpenRouter key status:", e)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // Close on ESC, and when the panel hides — matching AboutDialog's behavior.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault()
        onClose()
      }
    }
    const onVisibility = () => {
      if (document.hidden) onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [onClose])

  const handleSave = async () => {
    const trimmed = keyInput.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await invoke("save_openrouter_key", { key: trimmed })
      onClose()
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  const handleClear = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await invoke("clear_openrouter_key")
      setKeyInput("")
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const statusNote = status.saved
    ? "A key is saved. Enter a new one to replace it, or clear it."
    : status.fromEnv
      ? "Using the key from your environment. Save one here to override it."
      : "Create a key at OpenRouter, then paste it here."

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-card rounded-lg border shadow-xl p-5 max-w-xs w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-base font-semibold mb-1">OpenRouter API Key</h2>
        <p className="text-sm text-muted-foreground mb-3">
          OpenRouter has no CLI to read from, so add your{" "}
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
            onClick={() => void openUrl(OPENROUTER_KEYS_URL)}
          >
            API key <ExternalLink className="size-3" />
          </button>{" "}
          to track usage. It's stored in a local config file.
        </p>

        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          placeholder="sk-or-v1-..."
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSave()
          }}
          className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          aria-label="OpenRouter API key"
        />

        <p className="text-xs text-muted-foreground mt-2">{error ? error : statusNote}</p>

        <div className="flex items-center justify-end gap-2 mt-4">
          {status.saved && (
            <Button variant="destructive" size="sm" disabled={busy} onClick={() => void handleClear()}>
              Clear
            </Button>
          )}
          <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Cancel
          </Button>
          <Button variant="default" size="sm" disabled={busy || keyInput.trim().length === 0} onClick={() => void handleSave()}>
            Save
          </Button>
        </div>
      </div>
    </div>
  )
}
