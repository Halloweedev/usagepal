import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { getEnabledPluginIds } from "@/lib/settings"
import { isDevOnlyPlugin } from "@/lib/plugin-types"
import { useAppBudgetsStore } from "@/stores/app-budgets-store"
import { useAppPluginStore } from "@/stores/app-plugin-store"

const QUICK_PRESETS = [10, 20, 50]

function BudgetRow({
  providerName,
  budget,
  onCommit,
}: {
  providerName: string
  budget: number | undefined
  onCommit: (percent: number | null) => void
}) {
  const [text, setText] = useState(budget != null ? String(budget) : "")

  useEffect(() => {
    setText(budget != null ? String(budget) : "")
  }, [budget])

  const commit = () => {
    const trimmed = text.trim()
    if (trimmed === "") {
      onCommit(null)
      return
    }
    const parsed = Math.round(Number(trimmed))
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 100) {
      onCommit(parsed)
    } else {
      // Revert invalid input to the stored value.
      setText(budget != null ? String(budget) : "")
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate text-sm text-foreground">{providerName}</span>
      <div className="flex items-center gap-1">
        {QUICK_PRESETS.map((preset) => (
          <Button
            key={preset}
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Set ${providerName} budget to ${preset} percent`}
            className="h-7 px-1.5 text-xs"
            onClick={() => onCommit(preset)}
          >
            {preset}
          </Button>
        ))}
        <input
          type="number"
          min={1}
          max={100}
          inputMode="numeric"
          aria-label={`${providerName} budget percent`}
          placeholder="—"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur()
          }}
          className="h-7 w-14 rounded-md border border-input bg-background px-2 text-right text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
        />
        <span className="text-xs text-muted-foreground">%</span>
      </div>
    </div>
  )
}

/**
 * Per-provider budget editors, shown inside the Notifications dialog while the
 * Over Budget trigger is on. A budget caps one provider at a percent of its
 * limit per reset window — e.g. set 20% on Monday and get one alert per meter
 * when usage crosses it.
 */
export function BudgetEditors() {
  const budgets = useAppBudgetsStore((s) => s.budgets)
  const hydrate = useAppBudgetsStore((s) => s.hydrate)
  const setBudget = useAppBudgetsStore((s) => s.setBudget)
  const pluginsMeta = useAppPluginStore((s) => s.pluginsMeta)
  const pluginSettings = useAppPluginStore((s) => s.pluginSettings)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  const enabledIds = pluginSettings ? getEnabledPluginIds(pluginSettings) : []
  const providers = pluginsMeta
    .filter((meta) => enabledIds.includes(meta.id) && !isDevOnlyPlugin(meta.id))
    .sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="mt-4 border-t border-border/60 pt-3">
      <h3 className="text-sm font-semibold text-foreground">Usage Budgets</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Cap a provider at a percent of its limit per window. Crossing it sends one Over Budget
        alert per meter, re-armed each reset.
      </p>
      <div className="mt-2 space-y-2">
        {providers.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No providers enabled yet. Enable one to set a budget.
          </p>
        )}
        {providers.map((meta) => (
          <BudgetRow
            key={meta.id}
            providerName={meta.name}
            budget={budgets[meta.id]}
            onCommit={(percent) => setBudget(meta.id, percent)}
          />
        ))}
      </div>
    </div>
  )
}
