import { useCallback, useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ArrowSquareOut } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import type { OpenCodeGoKeyStatus } from "@/bindings"

const KEYS_URL = "https://opencode.ai/auth"

export function OpenCodeGoKeyDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const [status, setStatus] = useState<OpenCodeGoKeyStatus>({
    saved: false,
    fromOpenCode: false,
    fromEnv: false,
  })
  const [keyInput, setKeyInput] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    if (!isTauri()) return
    try {
      setStatus(await invoke<OpenCodeGoKeyStatus>("opencode_go_key_status"))
    } catch (cause) {
      console.error("Failed to read OpenCode Go key status:", cause)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
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
    const key = keyInput.trim()
    if (!key || busy) return
    setBusy(true)
    setError(null)
    try {
      await invoke("save_opencode_go_key", { key })
      onSaved()
    } catch (cause) {
      setError(String(cause))
      setBusy(false)
    }
  }

  const handleClear = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await invoke("clear_opencode_go_key")
      setKeyInput("")
      await refreshStatus()
    } catch (cause) {
      setError(String(cause))
    } finally {
      setBusy(false)
    }
  }

  const note = error
    ?? (status.saved
      ? "A key is saved."
      : status.fromOpenCode
        ? "Using the key from your OpenCode login."
        : status.fromEnv
          ? "Using OPENCODE_API_KEY from your environment."
          : null)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="bg-card rounded-lg border shadow-xl p-5 max-w-xs w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-base font-semibold mb-1">OpenCode Go API Key</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Paste your key to track usage.{" "}
          <button
            type="button"
            className="inline-flex items-center gap-0.5 text-primary hover:underline"
            onClick={() => void openUrl(KEYS_URL)}
          >
            Manage Keys <ArrowSquareOut className="size-3" />
          </button>
        </p>

        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoFocus
          placeholder="OpenCode API key"
          value={keyInput}
          onChange={(event) => setKeyInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void handleSave()
          }}
          className="w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          aria-label="OpenCode Go API key"
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
          {(status.saved || status.fromOpenCode || status.fromEnv) && !keyInput.trim() ? (
            <Button variant="default" size="sm" disabled={busy} onClick={onSaved}>
              Use Existing Key
            </Button>
          ) : (
            <Button variant="default" size="sm" disabled={busy || !keyInput.trim()} onClick={() => void handleSave()}>
              Save
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
