import { useMemo } from "react"

import type { GroupedProviderView } from "@/hooks/app/group-provider-views"

type Entry = {
  id: string
  name: string
  percent: number
  brandColor: string | null
}

export function ProviderUsageStrip({ groupedPlugins }: { groupedPlugins: GroupedProviderView[] }) {
  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = []
    for (const group of groupedPlugins) {
      const account = group.accounts[group.activeIndex ?? 0] ?? group.accounts[0]
      const lines = account?.data?.lines ?? []
      const progress = lines.find((line) => line.type === "progress" && line.used != null && line.limit != null && line.limit > 0)
      if (!progress || progress.type !== "progress" || progress.used == null || progress.limit == null) continue
      const percent = Math.min(100, Math.max(0, (progress.used / progress.limit) * 100))
      out.push({
        id: group.meta.id,
        name: group.meta.name,
        percent,
        brandColor: group.meta.brandColor ?? null,
      })
    }
    out.sort((a, b) => b.percent - a.percent)
    return out
  }, [groupedPlugins])

  if (entries.length === 0) return null

  return (
    <section className="mb-3 pt-2" aria-label="Usage at a glance">
      <h3 className="text-lg font-semibold mb-2">Usage at a Glance</h3>
      <div className="space-y-1.5">
        {entries.map((entry) => (
          <div key={entry.id} className="flex items-center gap-2 text-xs">
            <span className="w-24 truncate text-muted-foreground">{entry.name}</span>
            <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{ width: `${entry.percent}%`, backgroundColor: entry.brandColor ?? "currentColor" }}
              />
            </div>
            <span className="w-10 text-right tabular-nums text-muted-foreground">
              {Math.round(entry.percent)}%
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
