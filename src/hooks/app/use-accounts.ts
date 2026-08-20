import { useCallback, useEffect, useState } from "react"
import { type AccountsByProvider, loadAccounts } from "@/lib/settings"

/**
 * Reactive source of registered account metadata, keyed by provider. Seeded from
 * the settings store on mount; `reload` re-reads after an add/remove mutation so
 * the card UI (Plan 3) and settings surfaces reflect the change immediately.
 */
export function useAccounts(): {
  accountsByProvider: AccountsByProvider
  reload: () => Promise<void>
} {
  const [accountsByProvider, setAccountsByProvider] = useState<AccountsByProvider>({})

  const reload = useCallback(async () => {
    try {
      setAccountsByProvider(await loadAccounts())
    } catch (error) {
      console.error("Failed to load accounts:", error)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { accountsByProvider, reload }
}
