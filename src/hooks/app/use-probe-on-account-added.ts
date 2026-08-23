import { useEffect } from "react"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import {
  ACCOUNTS_CHANGED_EVENT,
  type AccountsChangedDetail,
} from "@/hooks/app/use-accounts"
import { stateKey } from "@/hooks/app/use-probe-state"

type CodexLoginComplete = { accountId: string; label: string }

type UseProbeOnAccountAddedArgs = {
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
}

/**
 * Refresh a newly added account so its card fills in without a manual refresh.
 *
 * This listens for the explicit add events rather than diffing account state
 * over time: an add is a discrete action, so we probe exactly when it happens
 * and touch only the account that was added. Because nothing here runs at
 * startup — and it can only ever load the one added key — it cannot mistake
 * restored-at-launch accounts for new ones, which is the failure the earlier
 * state-diffing approach had (it blanked existing accounts on every launch).
 *
 * The account is shown as loading immediately, then `start_probe_batch` (keyed
 * on the base provider id, expanded to every account by the backend) refreshes
 * it. Claude/Cursor announce via the same-window {@link ACCOUNTS_CHANGED_EVENT};
 * Codex finalizes in the backend and announces via `codex:login-complete`.
 */
export function useProbeOnAccountAdded({
  startBatch,
  setLoadingForPlugins,
  setErrorForPlugins,
}: UseProbeOnAccountAddedArgs): void {
  useEffect(() => {
    const probeAccount = (providerId: string, accountId: string) => {
      const key = stateKey(providerId, accountId)
      setLoadingForPlugins([key])
      startBatch([providerId]).catch((error) => {
        // Clear the spinner if the batch never starts.
        setErrorForPlugins([key], "Failed to refresh account")
        console.error("Failed to probe added account:", error)
      })
    }

    const onAccountsChanged = (event: Event) => {
      const detail = (event as CustomEvent<AccountsChangedDetail | undefined>).detail
      if (!detail?.added) return
      probeAccount(detail.providerId, detail.accountId)
    }
    window.addEventListener(ACCOUNTS_CHANGED_EVENT, onAccountsChanged)

    let unlisten: UnlistenFn | undefined
    void listen<CodexLoginComplete>("codex:login-complete", (event) => {
      probeAccount("codex", event.payload.accountId)
    }).then((fn) => {
      unlisten = fn
    })

    return () => {
      window.removeEventListener(ACCOUNTS_CHANGED_EVENT, onAccountsChanged)
      unlisten?.()
    }
  }, [startBatch, setLoadingForPlugins, setErrorForPlugins])
}
