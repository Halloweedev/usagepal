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
    <section className="mb-3 rounded-xl border p-1.5" aria-label="Usage at a glance">
      <div className="flex items-center justify-between gap-2 rounded-full bg-muted/50 py-1 pl-1 pr-2.5">
        <span className="text-xs font-medium text-foreground">Usage at a Glance</span>
      </div>
      <div className="px-1.5 pb-1.5 pt-3">
        <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="h-full transition-[filter] hover:brightness-125 first:rounded-l-full last:rounded-r-full"
              style={{
                width: `${Math.max(2, entry.percent)}%`,
                backgroundColor: entry.brandColor ?? "currentColor",
              }}
              title={`${entry.name}: ${Math.round(entry.percent)}%`}
            />
          ))}
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-x-4">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-[7px] rounded-[2px]" style={{ backgroundColor: entry.brandColor ?? "currentColor" }} />
              <span className="truncate">{entry.name}</span>
              <span className="ml-auto tabular-nums">{Math.round(entry.percent)}%</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
