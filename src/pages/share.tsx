import { useEffect, useMemo, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ShareCard, type ShareCardTheme } from "@/components/share-card"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import { buildShareableLines } from "@/lib/share-lines"
import { copyCardImage } from "@/lib/share-image"
import type { ModelDisplayOptions } from "@/lib/model-breakdown-format"

const CHECKLIST_GROUPS = [
  { scope: "overview", label: "Usage" },
  { scope: "detail", label: "Details" },
  { scope: "modelBreakdown", label: "Models" },
] as const

export type SharePageProps = {
  plugins: DisplayPluginState[]
}

type CopyState = "idle" | "copying" | "success" | "error"

export function SharePage({ plugins }: SharePageProps) {
  const [selectedId, setSelectedId] = useState<string | null>(plugins[0]?.meta.id ?? null)
  const [checkedLabels, setCheckedLabels] = useState<Set<string>>(new Set())
  const [theme, setTheme] = useState<ShareCardTheme>("dark")
  const [showWatermark, setShowWatermark] = useState(true)
  const [showPlan, setShowPlan] = useState(true)
  const [modelDisplay, setModelDisplay] = useState<ModelDisplayOptions>({
    showPercent: true,
    showToday: true,
    showSevenDay: true,
    showThirtyDay: true,
  })
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

  const groupedLines = useMemo(() => {
    return CHECKLIST_GROUPS.map((group) => ({
      label: group.label,
      entries: shareableLines.filter((entry) => entry.scope === group.scope),
    })).filter((group) => group.entries.length > 0)
  }, [shareableLines])

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

  const modelBreakdownLabels = useMemo(
    () => new Set(shareableLines.filter((entry) => entry.scope === "modelBreakdown").map((entry) => entry.line.label)),
    [shareableLines]
  )

  const hasCheckedModels = useMemo(
    () => [...modelBreakdownLabels].some((label) => checkedLabels.has(label)),
    [modelBreakdownLabels, checkedLabels]
  )

  const setModelDisplayField = (field: keyof ModelDisplayOptions, checked: boolean) => {
    setModelDisplay((prev) => ({ ...prev, [field]: checked }))
  }

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
    <div className="flex flex-row items-start gap-4" data-testid="share-page">
      <div className="flex min-w-0 flex-1 flex-col gap-2" data-testid="share-page-controls">
        <h2 className="text-sm font-semibold">Share Usage</h2>

        <Tabs value={selectedId ?? undefined} onValueChange={(value) => setSelectedId(String(value))}>
          <TabsList>
            {plugins.map((plugin) => (
              <TabsTrigger key={plugin.meta.id} value={plugin.meta.id} disabled={copyState === "copying"}>
                {plugin.meta.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {!selected?.data ? (
          <p className="text-sm text-muted-foreground">No data yet for this provider.</p>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              {groupedLines.map((group) => (
                <div key={group.label} className="flex flex-col gap-1">
                  <span className="text-[10px] font-medium uppercase text-muted-foreground">{group.label}</span>
                  <div className="flex flex-wrap gap-1">
                    {group.entries.map((entry) => (
                      <label
                        key={entry.line.label}
                        className="flex items-center gap-1.5 rounded-md border px-1.5 py-1 text-xs"
                      >
                        <Checkbox
                          aria-label={entry.line.label}
                          checked={checkedLabels.has(entry.line.label)}
                          onCheckedChange={(checked) => toggleLabel(entry.line.label, checked === true)}
                          disabled={copyState === "copying"}
                        />
                        {entry.line.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase text-muted-foreground">Card</span>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    aria-label="Light Card"
                    checked={theme === "light"}
                    onCheckedChange={(checked) => setTheme(checked === true ? "light" : "dark")}
                    disabled={copyState === "copying"}
                  />
                  Light Card
                </label>
                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    aria-label="Watermark"
                    checked={showWatermark}
                    onCheckedChange={(checked) => setShowWatermark(checked === true)}
                    disabled={copyState === "copying"}
                  />
                  Watermark
                </label>
                {selected.data.plan && (
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      aria-label="Plan"
                      checked={showPlan}
                      onCheckedChange={(checked) => setShowPlan(checked === true)}
                      disabled={copyState === "copying"}
                    />
                    Plan
                  </label>
                )}
              </div>
            </div>

            {hasCheckedModels && (
              <div className="flex flex-col gap-1" data-testid="share-model-details-section">
                <span className="text-[10px] font-medium uppercase text-muted-foreground">Model Details</span>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      aria-label="Usage %"
                      checked={modelDisplay.showPercent}
                      onCheckedChange={(checked) => setModelDisplayField("showPercent", checked === true)}
                      disabled={copyState === "copying"}
                    />
                    Usage %
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      aria-label="Today"
                      checked={modelDisplay.showToday}
                      onCheckedChange={(checked) => setModelDisplayField("showToday", checked === true)}
                      disabled={copyState === "copying"}
                    />
                    Today
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      aria-label="7 Days"
                      checked={modelDisplay.showSevenDay}
                      onCheckedChange={(checked) => setModelDisplayField("showSevenDay", checked === true)}
                      disabled={copyState === "copying"}
                    />
                    7 Days
                  </label>
                  <label className="flex items-center gap-1.5 text-xs">
                    <Checkbox
                      aria-label="30 Days"
                      checked={modelDisplay.showThirtyDay}
                      onCheckedChange={(checked) => setModelDisplayField("showThirtyDay", checked === true)}
                      disabled={copyState === "copying"}
                    />
                    30 Days
                  </label>
                </div>
              </div>
            )}

            <Button onClick={handleCopy} disabled={copyState === "copying" || checkedLines.length === 0}>
              {copyState === "copying" ? "Copying..." : "Copy Image"}
            </Button>
            {copyState === "success" && <p className="text-sm text-muted-foreground">Copied to clipboard.</p>}
            {copyState === "error" && <p className="text-sm text-destructive">{copyError}</p>}
          </>
        )}
      </div>

      {selected?.data && (
        <div className="flex shrink-0 items-start" data-testid="share-page-preview">
          <div ref={cardRef}>
            <ShareCard
              providerName={selected.meta.name}
              providerIconUrl={selected.meta.iconUrl}
              brandColor={selected.meta.brandColor}
              plan={showPlan ? selected.data.plan : undefined}
              lines={checkedLines}
              theme={theme}
              showWatermark={showWatermark}
              modelDisplay={modelDisplay}
              modelBreakdownLabels={modelBreakdownLabels}
            />
          </div>
        </div>
      )}
    </div>
  )
}
