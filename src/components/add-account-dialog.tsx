import { type ReactNode, useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { Button } from "@/components/ui/button"
import type { AccountAdded, CodexLoginStarted } from "@/bindings"

/** Metadata handed back to the parent so it can persist label + id in settings.json. */
export type SavedAccount = { accountId: string; label: string }

type DialogShellProps = {
  title: string
  onClose: () => void
  children: ReactNode
}

/** Overlay + ESC/hide-to-close shell shared by every add-account variant. Mirrors
 * OpenRouterKeyDialog's dismissal behavior. */
function DialogShell({ title, onClose, children }: DialogShellProps) {
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="bg-card rounded-lg border shadow-xl p-5 max-w-xs w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        <h2 className="text-base font-semibold mb-1">{title}</h2>
        {children}
      </div>
    </div>
  )
}

const inputClass =
  "w-full h-8 rounded-md border border-input bg-background px-2.5 text-sm outline-none focus-visible:ring-ring/50 focus-visible:ring-[3px]"

function LabelInput({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  return (
    <input
      type="text"
      autoComplete="off"
      spellCheck={false}
      autoFocus
      placeholder="e.g. Work"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className={inputClass}
      aria-label="Account label"
    />
  )
}

/** Add a Claude account from a `claude setup-token` value. */
export function AddClaudeAccountDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (providerId: string, account: SavedAccount) => void
}) {
  const [label, setLabel] = useState("")
  const [token, setToken] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSave = async () => {
    const trimmedToken = token.trim()
    if (!trimmedToken || busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await invoke<AccountAdded>("save_claude_account", {
        label: label.trim(),
        setupToken: trimmedToken,
      })
      onSaved("claude", { accountId: result.accountId, label: label.trim() })
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <DialogShell title="Add Claude Account" onClose={onClose}>
      <p className="text-sm text-muted-foreground mb-3">
        Run <code className="text-xs">claude setup-token</code> in the account you want, paste it
        here.
      </p>
      <div className="space-y-2">
        <LabelInput value={label} onChange={setLabel} disabled={busy} />
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-oat01-..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSave()
          }}
          disabled={busy}
          className={inputClass}
          aria-label="Setup token"
        />
      </div>
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      <div className="flex items-center justify-end gap-2 mt-4">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="default"
          size="sm"
          disabled={busy || token.trim().length === 0}
          onClick={() => void handleSave()}
        >
          Add account
        </Button>
      </div>
    </DialogShell>
  )
}

/** Add a Codex account via a managed `codex login` into a UsagePal-owned profile.
 *
 * The account is finalized in the backend (it watches the staging dir and emits
 * `codex:login-complete` once `codex login` writes auth.json), and persisted by
 * the always-mounted `useAccounts` listener — so the flow completes even though
 * the tray panel hides the instant the browser takes focus. This dialog only
 * kicks it off and reflects progress; `onSaved` is intentionally unused here. */
export function AddCodexAccountDialog({
  onClose,
  onSaved: _onSaved,
}: {
  onClose: () => void
  onSaved: (providerId: string, account: SavedAccount) => void
}) {
  const [label, setLabel] = useState("")
  const [waiting, setWaiting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleBegin = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await invoke<CodexLoginStarted>("begin_codex_login", { label: label.trim() })
      setWaiting(true)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }

  // Once a login is in flight, close on success and surface a timeout/error.
  useEffect(() => {
    if (!waiting) return
    let unlistenDone: UnlistenFn | undefined
    let unlistenFail: UnlistenFn | undefined
    void listen("codex:login-complete", () => onClose()).then((fn) => {
      unlistenDone = fn
    })
    void listen<{ message: string }>("codex:login-failed", (event) => {
      setError(event.payload.message)
      setWaiting(false)
    }).then((fn) => {
      unlistenFail = fn
    })
    return () => {
      unlistenDone?.()
      unlistenFail?.()
    }
  }, [waiting, onClose])

  return (
    <DialogShell title="Add Codex Account" onClose={onClose}>
      <p className="text-sm text-muted-foreground mb-3">
        {waiting
          ? "A browser window opened — finish signing in there. UsagePal adds the account automatically, so you can leave this open."
          : "Sign in with Codex — a browser window opens. UsagePal adds the account once you finish, no need to come back and confirm."}
      </p>
      <LabelInput value={label} onChange={setLabel} disabled={busy || waiting} />
      {waiting && !error && (
        <p className="text-xs text-muted-foreground mt-2">Waiting for the Codex sign-in to finish…</p>
      )}
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      <div className="flex items-center justify-end gap-2 mt-4">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          {waiting ? "Close" : "Cancel"}
        </Button>
        {!waiting && (
          <Button variant="default" size="sm" disabled={busy} onClick={() => void handleBegin()}>
            Sign in with Codex
          </Button>
        )}
      </div>
    </DialogShell>
  )
}

/** Add a Cursor account by snapshotting the currently signed-in Cursor login (read-only). */
export function AddCursorAccountDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: (providerId: string, account: SavedAccount) => void
}) {
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSnapshot = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const result = await invoke<AccountAdded>("snapshot_cursor_account", { label: label.trim() })
      onSaved("cursor", { accountId: result.accountId, label: label.trim() })
    } catch (e) {
      setError(String(e))
      setBusy(false)
    }
  }

  return (
    <DialogShell title="Add Cursor Account" onClose={onClose}>
      <p className="text-sm text-muted-foreground mb-3">
        Sign in to the account in the Cursor app first, then snapshot it here.
      </p>
      <LabelInput value={label} onChange={setLabel} disabled={busy} />
      {error && <p className="text-xs text-destructive mt-2">{error}</p>}
      <div className="flex items-center justify-end gap-2 mt-4">
        <Button variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          Cancel
        </Button>
        <Button variant="default" size="sm" disabled={busy} onClick={() => void handleSnapshot()}>
          Snapshot current Cursor login
        </Button>
      </div>
    </DialogShell>
  )
}
