import { useEffect, useState } from "react"
import { invoke, isTauri } from "@tauri-apps/api/core"
import { BellOff, BellRing, Check, CircleCheck, KeyRound, LoaderCircle, Power } from "lucide-react"
import type { PluginMeta } from "@/bindings"
import { Button } from "@/components/ui/button"
import { ProviderIconMask } from "@/components/provider-icon-mask"
import { StepShell } from "@/components/onboarding/step-shell"
import { hasManagedApiKey, isDevOnlyPlugin } from "@/lib/plugin-types"
import { cn } from "@/lib/utils"

type ProviderChip = {
  id: string
  name: string
  iconUrl: string
  /** Key-managed provider that is not detected yet: supported, needs its key. */
  needsKey: boolean
}

/** The done step's provider pick: `keep` stays enabled, `drop` gets disabled. */
export type ProviderSelection = { keep: string[]; drop: string[] }

type DoneStepProps = {
  alertsEnabled: number
  startOnLogin: boolean
  onFinish: (openSettings: boolean, selection: ProviderSelection) => void
  /** True while either finish action is in flight; disables both buttons. */
  busy: boolean
  /** Minimum time the "looking for providers" loader stays visible. */
  scanMinMs?: number
  /** Delay between each provider chip's reveal. */
  revealStepMs?: number
}

export function DoneStep({
  alertsEnabled,
  startOnLogin,
  onFinish,
  busy,
  scanMinMs = 900,
  revealStepMs = 300,
}: DoneStepProps) {
  // null = still scanning; then chips reveal one by one until settled.
  const [chips, setChips] = useState<ProviderChip[] | null>(null)
  const [revealed, setRevealed] = useState(0)
  // Detected chips start selected; needs-key chips start deselected.
  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!isTauri()) {
      setChips([])
      return
    }
    let cancelled = false
    const scan = async () => {
      const [plugins] = await Promise.all([
        invoke<PluginMeta[]>("list_plugins").catch((error) => {
          console.error("Failed to list plugins:", error)
          return []
        }),
        new Promise((resolve) => setTimeout(resolve, scanMinMs)),
      ])
      if (cancelled) return
      const toChip = (plugin: PluginMeta, needsKey: boolean): ProviderChip => ({
        id: plugin.id,
        name: plugin.name,
        iconUrl: plugin.iconUrl,
        needsKey,
      })
      const metas = (Array.isArray(plugins) ? plugins : []).filter((plugin) => !isDevOnlyPlugin(plugin.id))
      const detected = metas.filter((plugin) => plugin.detected)
      // Key-managed providers that were not detected are still worth surfacing:
      // they work as soon as the user adds their key in Settings → Plugins.
      const keyManaged = metas.filter((plugin) => !plugin.detected && hasManagedApiKey(plugin.id))
      setSelected(new Set(detected.map((plugin) => plugin.id)))
      setChips([
        ...detected.map((plugin) => toChip(plugin, false)),
        ...keyManaged.map((plugin) => toChip(plugin, true)),
      ])
    }
    void scan()
    return () => {
      cancelled = true
    }
  }, [scanMinMs])

  useEffect(() => {
    if (chips === null || revealed >= chips.length) return
    const timer = setTimeout(() => setRevealed((count) => count + 1), revealStepMs)
    return () => clearTimeout(timer)
  }, [chips, revealed, revealStepMs])

  const settled = chips !== null && revealed >= chips.length

  const toggleChip = (id: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const handleFinish = (openSettings: boolean) => {
    const all = chips ?? []
    onFinish(openSettings, {
      keep: all.filter((chip) => selected.has(chip.id)).map((chip) => chip.id),
      drop: all.filter((chip) => !selected.has(chip.id)).map((chip) => chip.id),
    })
  }

  const alertsText =
    alertsEnabled > 0 ? `${alertsEnabled} alert${alertsEnabled === 1 ? "" : "s"} on` : "Alerts off"
  const loginText = startOnLogin ? "Starts when you sign in" : "Starts only when you open it"

  return (
    <StepShell
      title="You're all set"
      description="UsagePal now lives in your menu bar, keeping your usage one glance away."
      actions={
        <Button size="lg" onClick={() => handleFinish(false)} disabled={busy}>
          Open UsagePal
        </Button>
      }
      secondaryAction={
        <Button size="lg" variant="ghost" onClick={() => handleFinish(true)} disabled={busy}>
          Open Settings
        </Button>
      }
    >
      <div className="flex h-full flex-col items-center justify-center gap-4 py-4">
        <CircleCheck className="size-12 text-primary animate-in zoom-in-50 fade-in duration-500" aria-hidden />

        {chips === null ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground animate-in fade-in duration-300">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Looking for providers on this Mac…
          </div>
        ) : chips.length === 0 ? (
          <p className="max-w-[280px] text-center text-sm text-muted-foreground animate-in fade-in duration-300">
            No providers detected yet — sign in to your AI tools and UsagePal will pick them up.
          </p>
        ) : (
          <div className="w-full space-y-2 animate-in fade-in duration-300">
            <p className="text-center text-xs font-medium text-muted-foreground">
              Detected on this Mac
            </p>
            <p className="text-center text-[10px] text-muted-foreground">
              Tap a provider to include or exclude it
            </p>
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              {chips.slice(0, revealed).map((chip) => {
                const isSelected = selected.has(chip.id)
                return (
                  <button
                    key={chip.id}
                    type="button"
                    data-testid={`provider-chip-${chip.id}`}
                    aria-pressed={isSelected}
                    onClick={() => toggleChip(chip.id)}
                    title={chip.needsKey ? "Add its key in Settings → Plugins" : undefined}
                    className={cn(
                      "flex items-center gap-1.5 rounded-full border bg-background px-2.5 py-1 text-xs font-medium animate-in zoom-in-75 fade-in duration-300 transition-opacity",
                      chip.needsKey && "text-muted-foreground",
                      isSelected ? "border-primary/50" : "opacity-40"
                    )}
                  >
                    <ProviderIconMask
                      iconUrl={chip.iconUrl}
                      pluginId={chip.id}
                      sizePx={12}
                      className={chip.needsKey ? "bg-muted-foreground" : "bg-foreground"}
                      fallbackClassName="text-foreground"
                    />
                    {chip.name}
                    {chip.needsKey && <KeyRound className="size-3" aria-hidden />}
                    {isSelected && <Check className="size-3 text-primary" aria-hidden />}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {settled && (
          <div
            className="w-full max-w-[280px] overflow-hidden rounded-2xl border bg-card text-sm shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-500"
            style={{ animationDelay: "150ms", animationFillMode: "both" }}
          >
            <div className="flex items-center gap-2.5 px-4 py-2.5">
              {alertsEnabled > 0 ? (
                <BellRing className="size-4 shrink-0 text-primary" aria-hidden />
              ) : (
                <BellOff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              )}
              <span className={cn(alertsEnabled > 0 ? "text-foreground" : "text-muted-foreground")}>
                {alertsText}
              </span>
            </div>
            <div className="flex items-center gap-2.5 border-t px-4 py-2.5">
              <Power
                className={cn("size-4 shrink-0", startOnLogin ? "text-primary" : "text-muted-foreground")}
                aria-hidden
              />
              <span className={cn(startOnLogin ? "text-foreground" : "text-muted-foreground")}>
                {loginText}
              </span>
            </div>
          </div>
        )}
      </div>
    </StepShell>
  )
}
