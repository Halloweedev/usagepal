import { useEffect, useState } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Button } from "@/components/ui/button"
import { useAppLicenseStore } from "@/stores/app-license-store"
import { cn } from "@/lib/utils"

export function SupporterSection() {
  const status = useAppLicenseStore((s) => s.status)
  const lastError = useAppLicenseStore((s) => s.lastError)
  const hasActivated = useAppLicenseStore((s) => s.hasActivated)
  const activate = useAppLicenseStore((s) => s.activate)
  const refresh = useAppLicenseStore((s) => s.refresh)
  const [key, setKey] = useState("")

  // Only donors (who previously activated) re-validate on open; free users make
  // no licensing call here — their anonymous beacon is handled in Rust.
  useEffect(() => {
    if (hasActivated) void refresh()
  }, [hasActivated, refresh])

  const checking = status === "checking"
  const isActive = status === "active"

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <h3 className="text-lg font-semibold mb-0">Supporter</h3>

      {isActive ? (
        <p className="text-sm text-muted-foreground">Supporter — Active</p>
      ) : (
        <>
          <form
            className="flex min-w-0 gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void activate(key)
            }}
          >
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="License Key"
              className={cn(
                "min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            />
            <Button type="submit" className="shrink-0 px-3" disabled={checking || key.trim() === ""}>
              {checking ? "Checking…" : "Activate"}
            </Button>
          </form>
          {lastError ? <p className="text-sm text-destructive">{lastError}</p> : null}
        </>
      )}

      <Button
        variant="link"
        className="h-auto self-start p-0 text-xs text-muted-foreground"
        onClick={() => openUrl("https://keylight.dev").catch(console.error)}
      >
        Secured by Keylight.dev
      </Button>
    </section>
  )
}
