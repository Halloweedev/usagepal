import { useCallback, useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { Button } from "@/components/ui/button"
import type { ClinePassKeyStatus } from "@/bindings"

/**
 * Small modal for adding / clearing the ClinePass API key, opened from the ClinePass row in the
 * plugin list. `onSaved` fires only after a successful save; `onClose` fires on cancel/dismiss (the
 * caller uses that to undo an enable). The saved key is never read back into the webview.
 */
export function ClinePassKeyDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [status, setStatus] = useState<ClinePassKeyStatus>({ saved: false, fromEnv: false })
  const [keyInput, setKeyInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    if (!isTauri()) return
    try {
      const result = await invoke<ClinePassKeyStatus>("clinepass_key_status")
      if (result && typeof result === "object") setStatus(result)
    } catch (e) {
      console.error("Failed to read ClinePass key status:", e)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

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
      await invoke("save_clinepass_key", { key: trimmed })
      onSaved()
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
      await invoke("clear_clinepass_key")
      setKeyInput("")
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  let note: string | null = null
  if (error) {
    note = error
  } else if (status.saved) {
    note = "A key is saved."
  } else if (status.fromEnv) {
    note = "Using a key from your environment."
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-card rounded-lg border shadow-xl p-5 max-w-xs w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-base font-semibold mb-1">ClinePass API Key</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Paste your Cline API key to track ClinePass usage without the Cline app installed.
        </p>

        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          placeholder="cline-..."
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSave()
          }}
          className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          aria-label="ClinePass API key"
        />

        {note && <p className="text-xs text-muted-foreground mt-2">{note}</p>}

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
