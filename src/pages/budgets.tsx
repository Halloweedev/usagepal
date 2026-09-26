import { useEffect, useState } from "react"
import { Minus, Plus } from "@phosphor-icons/react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import type { MetricLine } from "@/lib/plugin-types"
import {
  addDaysKey,
  dayKeyToDate,
  localDayKey,
  metricKey,
} from "@/lib/pace-notifications"
import { useAppBudgetsStore } from "@/stores/app-budgets-store"
import { useAppNotificationsStore } from "@/stores/app-notifications-store"
import { cn } from "@/lib/utils"

const QUICK_PRESETS = [10, 20, 50]
const PLANNABLE_DAYS = 7
const STEP_PERCENT = 5

type ProgressMeter = Extract<MetricLine, { type: "progress" }>

function BudgetPercentInput({
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

  const nudge = (delta: number) => {
    // From empty, stepping up starts a budget; stepping down does nothing.
    // Otherwise move in 5-point steps, clamped to a real budget.
    if (budget == null) {
      if (delta > 0) onCommit(STEP_PERCENT)
      return
    }
    onCommit(Math.min(100, Math.max(1, Math.round(budget + delta))))
  }

  return (
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
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Decrease ${providerName} budget`}
        className="h-7 w-7 px-0"
        onClick={() => nudge(-STEP_PERCENT)}
      >
        <Minus className="size-3" />
      </Button>
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
        className="budget-percent-input h-7 w-12 rounded-md border border-input bg-background px-2 text-right text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
      />
      <span className="text-xs text-muted-foreground">%</span>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-label={`Increase ${providerName} budget`}
        className="h-7 w-7 px-0"
        onClick={() => nudge(STEP_PERCENT)}
      >
        <Plus className="size-3" />
      </Button>
    </div>
  )
}

function windowUsedPercent(line: ProgressMeter): number | null {
  const { used, limit } = line
  if (used == null || limit == null || !Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
    return null
  }
  return Math.min(100, Math.max(0, (used / limit) * 100))
}

function MeterRow({
  label,
  used,
  todayUsed,
  budget,
}: {
  label: string
  /** Window-to-date used percent, for context. */
  used: number | null
  /** Consumed since the budget was set; null when no budget is live. */
  todayUsed: number | null
  budget: number | undefined
}) {
  const over = todayUsed != null && budget != null && todayUsed >= budget
  // The bar tracks today's consumption against the budget; without a budget it
  // falls back to window usage for context.
  const barFill = todayUsed != null && budget != null ? Math.min(100, (todayUsed / budget) * 100) : null
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        <span className={cn("shrink-0 text-xs", over ? "font-medium text-destructive" : "text-muted-foreground")}>
          {used == null
            ? "No data yet"
            : todayUsed == null || budget == null
              ? `${Math.round(used)}% used`
              : over
                ? `Over budget — ${Math.round(todayUsed)}% of ${budget}% today`
                : `${Math.round(todayUsed)}% of ${budget}% today`}
        </span>
      </div>
      <div
        className="relative h-1.5 overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`${label}: ${used == null ? "no data" : `${Math.round(used)} percent used`}${todayUsed != null && budget != null ? `, ${Math.round(todayUsed)} of ${budget} percent daily budget` : ""}`}
      >
        {barFill != null ? (
          <div
            className={cn("absolute inset-y-0 left-0 rounded-full", over ? "bg-destructive" : "bg-primary")}
            style={{ width: `${barFill}%` }}
          />
        ) : (
          used != null && (
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-muted-foreground/40"
              style={{ width: `${Math.min(100, used)}%` }}
            />
          )
        )}
      </div>
    </div>
  )
}

/**
 * Budgets tab: plan the week day by day — 20% Monday, 10% Tuesday. Today's budget
 * counts from the moment you set it; future days start tracking at midnight and
 * wait their turn. Crossing a live budget sends one Over Budget alert per meter.
 */
export function BudgetsPage({ plugins }: { plugins: DisplayPluginState[] }) {
  const budgets = useAppBudgetsStore((s) => s.budgets)
  const hydrateBudgets = useAppBudgetsStore((s) => s.hydrate)
  const setBudget = useAppBudgetsStore((s) => s.setBudget)
  const alertsOn = useAppNotificationsStore((s) => s.settings.budgetExceeded)
  const setToggle = useAppNotificationsStore((s) => s.setToggle)
  const hydrateNotifications = useAppNotificationsStore((s) => s.hydrate)
  const today = localDayKey()
  const [selectedDay, setSelectedDay] = useState(today)
  // A midnight rollover while the tab sits open never strands the view on yesterday.
  const effectiveDay = selectedDay < today ? today : selectedDay
  const viewingToday = effectiveDay === today

  useEffect(() => {
    void hydrateBudgets()
  }, [hydrateBudgets])

  useEffect(() => {
    void hydrateNotifications()
  }, [hydrateNotifications])

  const now = new Date()
  const days = Array.from({ length: PLANNABLE_DAYS }, (_, offset) => {
    const key = addDaysKey(now, offset)
    const date = dayKeyToDate(key)
    return {
      key,
      short: offset === 0 ? "Today" : date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }),
      full: date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
    }
  })

  const snapshotMeters = (plugin: DisplayPluginState): Record<string, number> => {
    const snapshot: Record<string, number> = {}
    for (const line of plugin.data?.lines ?? []) {
      if (line.type !== "progress") continue
      const { used, limit } = line
      if (used == null || limit == null || !Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) {
        continue
      }
      // Snapshot in used-fraction units to match the alert engine.
      snapshot[metricKey(plugin.meta.id, plugin.data?.accountId, line.label)] =
        Math.min(1, Math.max(0, used / limit))
    }
    return snapshot
  }

  return (
    <div className="space-y-4 px-1 py-2">
      <div>
        <h2 className="text-base font-semibold text-foreground">Budgets</h2>
        <div className="mt-2 flex flex-nowrap gap-1 overflow-x-auto scrollbar-none" role="group" aria-label="Budget day">
          {days.map((day) => (
            <Button
              key={day.key}
              type="button"
              variant={day.key === effectiveDay ? "default" : "ghost"}
              size="sm"
              aria-label={`Budgets for ${day.full}`}
              aria-pressed={day.key === effectiveDay}
              className="h-7 shrink-0 px-2 text-xs"
              onClick={() => setSelectedDay(day.key)}
            >
              {day.short}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {viewingToday ? (
            <>
              Daily allowances — 20% Monday, 10% Tuesday. Today counts from now, future days
              from midnight. One alert per meter.
            </>
          ) : (
            <>
              Planning {days.find((day) => day.key === effectiveDay)?.full}. Meters start
              tracking at midnight; anything you set waits quietly until then.
            </>
          )}
        </p>
      </div>

      <label className="flex cursor-pointer items-start gap-3 select-none rounded-lg border border-border/60 bg-background px-3 py-2">
        <Checkbox
          checked={alertsOn}
          onCheckedChange={(checked) => setToggle("budgetExceeded", checked === true)}
          className="mt-0.5"
          aria-label="Over Budget alerts. Alert when usage crosses a budget you set."
        />
        <span>
          <span className="block text-sm font-medium text-foreground">Over Budget alerts</span>
          <span className="block text-xs text-muted-foreground">
            {alertsOn
              ? "On — crossing a budget notifies you once per meter."
              : "Off — budgets are kept but never alert. Turn on to be notified."}
          </span>
        </span>
      </label>

      {plugins.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No providers enabled yet. Enable one in Settings to set a budget.
        </p>
      )}

      {plugins.map((plugin) => {
        const entry = budgets[plugin.meta.id]?.[effectiveDay] ?? null
        const meters = (plugin.data?.lines ?? []).filter(
          (line): line is ProgressMeter => line.type === "progress"
        )
        return (
          <section key={plugin.meta.id} aria-label={`${plugin.meta.name} budget`}>
            <h3 className="truncate text-sm font-semibold text-foreground">{plugin.meta.name}</h3>
            <div className="mt-1.5">
              <BudgetPercentInput
                providerName={plugin.meta.name}
                budget={entry?.percent}
                onCommit={(percent) =>
                  setBudget(
                    plugin.meta.id,
                    percent,
                    percent == null || !viewingToday ? undefined : snapshotMeters(plugin),
                    effectiveDay
                  )
                }
              />
            </div>
            {entry != null && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                {viewingToday ? (
                  <>
                    Set today at{" "}
                    {new Date(entry.setAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                    .
                  </>
                ) : (
                  <>Planned for {days.find((day) => day.key === effectiveDay)?.full}.</>
                )}
              </p>
            )}
            <div className="mt-2 space-y-2.5">
              {meters.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  {plugin.data == null ? "Waiting for usage…" : "This provider has no limit meters."}
                </p>
              )}
              {meters.map((line) => {
                const used = windowUsedPercent(line)
                // Future days have no baseline yet: show window usage for context until
                // midnight tracking begins.
                const baseline = viewingToday ? entry?.baselines[metricKey(plugin.meta.id, plugin.data?.accountId, line.label)] : undefined
                const todayUsed =
                  entry != null && viewingToday && used != null
                    ? Math.max(0, used - (baseline != null ? baseline * 100 : used))
                    : null
                return (
                  <MeterRow
                    key={line.label}
                    label={line.label}
                    used={used}
                    todayUsed={todayUsed}
                    budget={entry?.percent}
                  />
                )
              })}
            </div>
          </section>
        )
      })}
    </div>
  )
}
