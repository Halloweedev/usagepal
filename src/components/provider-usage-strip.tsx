import { useMemo } from "react"
import { Donut } from "@/components/donut"
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

  const avg = Math.round(entries.reduce((s, e) => s + e.percent, 0) / entries.length)

  return (
    <section className="mb-3 pt-2" aria-label="Usage at a glance">
      <h3 className="text-lg font-semibold mb-2">Usage at a Glance</h3>
      <div className="rounded-xl border p-1.5">
        <div className="flex items-center gap-4 px-1.5 pb-1.5 pt-3">
        <Donut
          size={96}
          radius={36}
          stroke={13}
          gap={0.8}
          testId="usage-donut"
          sliceTestId="usage-donut-segment"
          slices={entries.map((entry) => ({
            key: entry.id,
            share: Math.max(entry.percent, 1),
            color: entry.brandColor ?? "currentColor",
          }))}
        >
          <text
            x={48}
            y={48}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="currentColor"
            fontSize={18}
            fontWeight={600}
          >
            {avg}%
          </text>
        </Donut>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {entries.map((entry) => (
            <div key={entry.id} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="size-[7px] shrink-0 rounded-[2px]" style={{ backgroundColor: entry.brandColor ?? "currentColor" }} />
              <span className="truncate">{entry.name}</span>
              <span className="ml-auto tabular-nums">{Math.round(entry.percent)}%</span>
            </div>
          ))}
        </div>
      </div>
      </div>
    </section>
  )
}