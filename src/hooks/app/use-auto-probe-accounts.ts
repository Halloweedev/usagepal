import { useEffect, useRef } from "react"
import type { AccountsByProvider } from "@/lib/settings"
import { stateKey } from "@/hooks/app/use-probe-state"

type UseAutoProbeAccountsArgs = {
  accountsByProvider: AccountsByProvider
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
  setLoadingForPlugins: (ids: string[]) => void
}

/**
 * A freshly added account has metadata but no probe state yet, so its card
 * renders empty (`EMPTY_STATE`) until the user triggers a manual refresh. This
 * watches the registered accounts and kicks a one-shot probe for any provider
 * that just gained an account key, so the new card populates itself.
 *
 * The backend `start_probe_batch` keys on the base provider id and internally
 * expands to every registered account (via the on-disk registry), so we probe
 * by provider id — not the composite `provider::account` key, which would match
 * nothing and yield an empty batch. New keys are shown as loading immediately so
 * the card shows a spinner instead of an empty body while the probe runs.
 *
 * The first run only records a baseline: accounts known at startup are already
 * covered by cache hydration and the native scheduler, so we never probe on
 * mount — only on genuine additions after that.
 */
export function useAutoProbeAccounts({
  accountsByProvider,
  startBatch,
  setLoadingForPlugins,
}: UseAutoProbeAccountsArgs): void {
  const knownKeysRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    const currentKeys = new Set<string>()
    const newKeys: string[] = []
    const providersWithNewAccounts = new Set<string>()

    for (const [providerId, accounts] of Object.entries(accountsByProvider)) {
      for (const acct of accounts ?? []) {
        const key = stateKey(providerId, acct.accountId)
        currentKeys.add(key)
        if (knownKeysRef.current && !knownKeysRef.current.has(key)) {
          newKeys.push(key)
          providersWithNewAccounts.add(providerId)
        }
      }
    }

    knownKeysRef.current = currentKeys

    // First run records the baseline without probing.
    if (newKeys.length === 0) return

    setLoadingForPlugins(newKeys)
    void startBatch([...providersWithNewAccounts]).catch((error) => {
      console.error("Failed to auto-probe added accounts:", error)
    })
  }, [accountsByProvider, startBatch, setLoadingForPlugins])
}
