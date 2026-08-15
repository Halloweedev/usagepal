import { useCallback, useEffect, useRef, useState } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import {
  type AccountsByProvider,
  type SelectedAccounts,
  loadAccounts,
  loadSelectedAccounts,
  saveAccounts,
  saveSelectedAccounts,
  upsertAccount,
} from "@/lib/settings"

type CodexLoginComplete = { accountId: string; label: string }

/** Same-window signal that registered accounts changed (added or removed). Any
 * mounted `useAccounts` reloads on it, so the card view stays in sync with the
 * settings dialog's separate instance. */
export const ACCOUNTS_CHANGED_EVENT = "usagepal:accounts-changed"

/** Broadcast that accounts changed. Call after persisting an add/remove. */
export function emitAccountsChanged(): void {
  window.dispatchEvent(new Event(ACCOUNTS_CHANGED_EVENT))
}

/**
 * Reactive source of registered account metadata, keyed by provider. Seeded from
 * the settings store on mount; `reload` re-reads after an add/remove mutation so
 * the card UI (Plan 3) and settings surfaces reflect the change immediately.
 *
 * Also owns the persisted per-provider selection (which account each provider
 * shows). `selectAccount` writes it through to the store so the choice survives
 * restart and the tray — reading the same value — stays in sync with the card.
 */
export function useAccounts(): {
  accountsByProvider: AccountsByProvider
  selectedByProvider: SelectedAccounts
  selectAccount: (providerId: string, accountId: string) => void
  reload: () => Promise<void>
} {
  const [accountsByProvider, setAccountsByProvider] = useState<AccountsByProvider>({})
  const [selectedByProvider, setSelectedByProvider] = useState<SelectedAccounts>({})
  const selectedRef = useRef<SelectedAccounts>(selectedByProvider)

  const reload = useCallback(async () => {
    try {
      const [accounts, selected] = await Promise.all([
        loadAccounts(),
        loadSelectedAccounts(),
      ])
      setAccountsByProvider(accounts)
      selectedRef.current = selected
      setSelectedByProvider(selected)
    } catch (error) {
      console.error("Failed to load accounts:", error)
    }
  }, [])

  const selectAccount = useCallback((providerId: string, accountId: string) => {
    const next = { ...selectedRef.current, [providerId]: accountId }
    selectedRef.current = next
    setSelectedByProvider(next)
    void saveSelectedAccounts(next).catch((error) => {
      console.error("Failed to save selected account:", error)
    })
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // The add/remove flows live in a separate component tree (the settings dialog)
  // with its own `useAccounts` instance, so its `reload` doesn't refresh this
  // one. A same-window broadcast keeps every instance — card view included — in
  // sync when an account is added or removed (Codex has its own native event).
  useEffect(() => {
    const onChanged = () => void reload()
    window.addEventListener(ACCOUNTS_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(ACCOUNTS_CHANGED_EVENT, onChanged)
  }, [reload])

  // The Codex login finishes in the backend (it watches the staging dir and
  // emits this once `codex login` writes auth.json), so completion doesn't
  // depend on the add-account dialog — the tray panel hides the moment the
  // browser takes focus. Persist the metadata here, in an always-mounted hook,
  // then reload. Idempotent (upsert by accountId) if several instances run.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined
    void listen<CodexLoginComplete>("codex:login-complete", async (event) => {
      try {
        const current = await loadAccounts()
        await saveAccounts(
          upsertAccount(current, "codex", {
            accountId: event.payload.accountId,
            label: event.payload.label.trim() || "Codex",
            order: current.codex?.length ?? 0,
          })
        )
      } catch (error) {
        console.error("Failed to persist Codex account:", error)
      }
      await reload()
    }).then((fn) => {
      unlisten = fn
    })
    return () => {
      unlisten?.()
    }
  }, [reload])

  return { accountsByProvider, selectedByProvider, selectAccount, reload }
}
