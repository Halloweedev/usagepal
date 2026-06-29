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
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold">Supporter</h2>

      {isActive ? (
        <p className="text-sm text-muted-foreground">Supporter — Active</p>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Support UsagePal — activate your supporter license key.
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Enter Your License Key"
              className={cn(
                "flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm",
                "outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            />
            <Button onClick={() => void activate(key)} disabled={checking || key.trim() === ""}>
              {checking ? "Checking…" : "Activate"}
            </Button>
          </div>
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
