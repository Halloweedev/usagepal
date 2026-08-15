import { useEffect, useRef } from "react"
import type { AccountsByProvider } from "@/lib/settings"
import type { PluginState } from "@/hooks/app/types"
import { stateKey } from "@/hooks/app/use-probe-state"

/** Accounts that arrive within this window of mount are treated as restored at
 * startup (baseline), not freshly added — they hydrate from cache and the
 * native scheduler already, so re-probing them on every launch is wasted work
 * (and doubles a provider's probe volume, which can trip usage rate limits). */
const STARTUP_SETTLE_MS = 2000

type UseAutoProbeAccountsArgs = {
  accountsByProvider: AccountsByProvider
  pluginStates: Record<string, PluginState>
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
  setLoadingForPlugins: (ids: string[]) => void
}

/**
 * A freshly added account has metadata but no probe state yet, so its card
 * renders empty until the user triggers a manual refresh. This watches the
 * registered accounts and kicks a one-shot probe for a provider that just
 * gained an account, so the new card fills in on its own.
 *
 * Two guards keep it from disturbing accounts that already exist:
 *
 *   1. Accounts seen within `STARTUP_SETTLE_MS` of mount are recorded as the
 *      baseline without probing. `useAccounts` starts empty and loads async, so
 *      without this the restored accounts look "newly added" on every launch and
 *      get needlessly re-probed — which is what blanked Codex cards to 0.
 *   2. Even after settle, a key that already has probe state (hydrated from
 *      cache or a prior probe) is skipped; only a truly stateless key probes.
 *
 * The backend `start_probe_batch` keys on the base provider id and internally
 * expands to every registered account, so we probe by provider id — not the
 * composite `provider::account` key, which would match nothing.
 */
export function useAutoProbeAccounts({
  accountsByProvider,
  pluginStates,
  startBatch,
  setLoadingForPlugins,
}: UseAutoProbeAccountsArgs): void {
  const seenRef = useRef<Set<string>>(new Set())
  const readyRef = useRef(false)

  // Read plugin state through a ref so probe results landing don't re-run the
  // detection effect (which would re-probe on its own output).
  const pluginStatesRef = useRef(pluginStates)
  useEffect(() => {
    pluginStatesRef.current = pluginStates
  }, [pluginStates])

  useEffect(() => {
    const timer = setTimeout(() => {
      readyRef.current = true
    }, STARTUP_SETTLE_MS)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    const newKeys: string[] = []
    const providersToProbe = new Set<string>()

    for (const [providerId, accounts] of Object.entries(accountsByProvider)) {
      for (const acct of accounts ?? []) {
        const key = stateKey(providerId, acct.accountId)
        if (seenRef.current.has(key)) continue
        seenRef.current.add(key)
        // Startup window: record the baseline, never probe.
        if (!readyRef.current) continue
        // Already has data (cache or a prior probe): nothing to refresh.
        if (pluginStatesRef.current[key] != null) continue
        newKeys.push(key)
        providersToProbe.add(providerId)
      }
    }

    if (providersToProbe.size === 0) return

    setLoadingForPlugins(newKeys)
    void startBatch([...providersToProbe]).catch((error) => {
      console.error("Failed to auto-probe added accounts:", error)
    })
  }, [accountsByProvider, startBatch, setLoadingForPlugins])
}
