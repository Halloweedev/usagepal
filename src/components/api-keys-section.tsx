import { useCallback, useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { openUrl } from "@tauri-apps/plugin-opener"
import { ExternalLink } from "lucide-react"
import { Button } from "@/components/ui/button"

type KeyStatus = { saved: boolean; fromEnv: boolean }

const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys"

export function ApiKeysSection() {
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

  const handleSave = async () => {
    const trimmed = keyInput.trim()
    if (!trimmed || busy) return
    setBusy(true)
    setError(null)
    try {
      await invoke("save_openrouter_key", { key: trimmed })
      setKeyInput("")
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const handleClear = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await invoke("clear_openrouter_key")
      await refreshStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  const statusNote = status.saved
    ? status.fromEnv
      ? "Saved key in use (overrides the environment key)."
      : "Key saved."
    : status.fromEnv
      ? "Using the key from your environment. Save one here to override it."
      : "No key set — paste one to start tracking OpenRouter."

  return (
    <section>
      <h3 className="text-lg font-semibold mb-0">API Keys</h3>
      <p className="text-sm text-muted-foreground mb-2">
        OpenRouter has no CLI to read from, so add your{" "}
        <button
          type="button"
          className="inline-flex items-center gap-0.5 text-primary hover:underline"
          onClick={() => void openUrl(OPENROUTER_KEYS_URL)}
        >
          API key <ExternalLink className="size-3" />
        </button>{" "}
        to track it. It's stored in a local config file.
      </p>
      <div className="flex items-center gap-2">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-or-v1-..."
          value={keyInput}
          onChange={(e) => setKeyInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSave()
          }}
          className="flex-1 h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          aria-label="OpenRouter API key"
        />
        <Button variant="outline" size="sm" disabled={busy || keyInput.trim().length === 0} onClick={() => void handleSave()}>
          Save
        </Button>
        {status.saved && (
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => void handleClear()}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground mt-2">{error ? error : statusNote}</p>
    </section>
  )
}
