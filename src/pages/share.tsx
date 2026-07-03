import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ShareCard, type ShareCardTheme } from "@/components/share-card"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import { buildShareableLines, matchModelCostPeriod, MODEL_COST_PERIODS } from "@/lib/share-lines"
import { copyCardImage } from "@/lib/share-image"

export type SharePageProps = {
  plugins: DisplayPluginState[]
}

type CopyState = "idle" | "copying" | "success" | "error"

export function SharePage({ plugins }: SharePageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(plugins[0]?.meta.id ?? null)
  const [checkedLabels, setCheckedLabels] = useState<Set<string>>(new Set())
  const [theme, setTheme] = useState<ShareCardTheme>("dark")
  const [showWatermark, setShowWatermark] = useState(true)
  const [copyState, setCopyState] = useState<CopyState>("idle")
  const [copyError, setCopyError] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const seededForRef = useRef<string | null>(null)

  useEffect(() => {
    if (selectedId && plugins.some((plugin) => plugin.meta.id === selectedId)) return
    setSelectedId(plugins[0]?.meta.id ?? null)
  }, [plugins, selectedId])

  const selected = useMemo(
    () => plugins.find((plugin) => plugin.meta.id === selectedId) ?? null,
    [plugins, selectedId]
  )

  const shareableLines = useMemo(() => {
    if (!selected?.data) return []
    return buildShareableLines(selected.data.lines, selected.meta.lines)
  }, [selected])

  const periodGroups = useMemo(() => {
    const groups = new Map<string, string[]>()
    for (const entry of shareableLines) {
      const period = matchModelCostPeriod(entry.line.label)
      if (!period) continue
      const list = groups.get(period.label) ?? []
      list.push(entry.line.label)
      groups.set(period.label, list)
    }
    return groups
  }, [shareableLines])

  const allPeriodLabels = useMemo(() => Array.from(periodGroups.values()).flat(), [periodGroups])

  const toggleGroup = (labels: string[]) => {
    setCheckedLabels((prev) => {
      const allChecked = labels.length > 0 && labels.every((label) => prev.has(label))
      const next = new Set(prev)
      for (const label of labels) {
        if (allChecked) next.delete(label)
        else next.add(label)
      }
      return next
    })
  }

  useEffect(() => {
    if (seededForRef.current === selectedId) return
    seededForRef.current = selectedId
    setCheckedLabels(
      new Set(shareableLines.filter((entry) => entry.defaultChecked).map((entry) => entry.line.label))
    )
    setCopyState("idle")
    setCopyError(null)
  }, [selectedId, shareableLines])

  const checkedLines = useMemo(
    () => shareableLines.filter((entry) => checkedLabels.has(entry.line.label)).map((entry) => entry.line),
    [shareableLines, checkedLabels]
  )

  const toggleLabel = (label: string, checked: boolean) => {
    setCheckedLabels((prev) => {
      const next = new Set(prev)
      if (checked) next.add(label)
      else next.delete(label)
      return next
    })
  }

  const handleCopy = async () => {
    if (!cardRef.current) return
    setCopyState("copying")
    setCopyError(null)
    try {
      await copyCardImage(cardRef.current)
      setCopyState("success")
    } catch (error) {
      setCopyState("error")
      setCopyError(error instanceof Error ? error.message : "Failed to copy image.")
    }
  }

  if (plugins.length === 0) {
    return <p className="text-sm text-muted-foreground">No providers enabled yet.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold">Share Usage</h2>

      <Tabs value={selectedId ?? undefined} onValueChange={(value) => setSelectedId(String(value))}>
        <TabsList>
          {plugins.map((plugin) => (
            <TabsTrigger key={plugin.meta.id} value={plugin.meta.id}>
              {plugin.meta.name}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {!selected?.data ? (
        <p className="text-sm text-muted-foreground">No data yet for this provider.</p>
      ) : (
        <>
          {MODEL_COST_PERIODS.some((period) => periodGroups.has(period.label)) && (
            <div className="flex flex-wrap items-center gap-1">
              {MODEL_COST_PERIODS.map((period) => {
                const labels = periodGroups.get(period.label)
                if (!labels) return null
                const allChecked = labels.every((label) => checkedLabels.has(label))
                return (
                  <Button
                    key={period.label}
                    size="xs"
                    variant={allChecked ? "default" : "outline"}
                    onClick={() => toggleGroup(labels)}
                  >
                    {period.label}
                  </Button>
                )
              })}
              <Button
                size="xs"
                variant={
                  allPeriodLabels.length > 0 && allPeriodLabels.every((label) => checkedLabels.has(label))
                    ? "default"
                    : "outline"
                }
                onClick={() => toggleGroup(allPeriodLabels)}
              >
                All periods
              </Button>
            </div>
          )}

          <div className="flex max-h-28 flex-col gap-1 overflow-y-auto pr-1">
            {shareableLines.map((entry) => (
              <label key={entry.line.label} className="flex items-center gap-1.5 text-xs">
                <Checkbox
                  aria-label={entry.line.label}
                  checked={checkedLabels.has(entry.line.label)}
                  onCheckedChange={(checked) => toggleLabel(entry.line.label, checked === true)}
                />
                {entry.line.label}
              </label>
            ))}
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                aria-label="Light card"
                checked={theme === "light"}
                onCheckedChange={(checked) => setTheme(checked === true ? "light" : "dark")}
              />
              Light card
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <Checkbox
                aria-label="Watermark"
                checked={showWatermark}
                onCheckedChange={(checked) => setShowWatermark(checked === true)}
              />
              Watermark
            </label>
          </div>

          <div ref={cardRef}>
            <ShareCard
              providerName={selected.meta.name}
              providerIconUrl={selected.meta.iconUrl}
              brandColor={selected.meta.brandColor}
              lines={checkedLines}
              theme={theme}
              showWatermark={showWatermark}
            />
          </div>

          <Button onClick={handleCopy} disabled={copyState === "copying" || checkedLines.length === 0}>
            {copyState === "copying" ? "Copying..." : "Copy Image"}
          </Button>
          {copyState === "success" && <p className="text-sm text-muted-foreground">Copied to clipboard.</p>}
          {copyState === "error" && <p className="text-sm text-destructive">{copyError}</p>}
        </>
      )}
    </div>
  )
}
