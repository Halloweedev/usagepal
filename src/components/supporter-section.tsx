import { useEffect } from "react"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Button } from "@/components/ui/button"
import { useAppLicenseStore } from "@/stores/app-license-store"

export function SupporterSection() {
  const status = useAppLicenseStore((s) => s.status)
  const hasActivated = useAppLicenseStore((s) => s.hasActivated)
  const refresh = useAppLicenseStore((s) => s.refresh)

  // Only donors (who previously activated) re-validate on open; free users make
  // no licensing call here — their anonymous beacon is handled in Rust.
  useEffect(() => {
    if (hasActivated) void refresh()
  }, [hasActivated, refresh])

  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="text-lg font-semibold mb-0">Supporter</h3>

      {status === "active" ? (
        <p className="text-sm text-muted-foreground">Supporter — Active</p>
      ) : null}

      <Button
        variant="link"
        className="h-auto justify-start p-0 text-sm"
        onClick={() => openUrl("https://buymeacoffee.com/dmzxnico").catch(console.error)}
      >
        Buy Me a Coffee
      </Button>
    </section>
  )
}
