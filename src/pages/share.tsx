import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ShareCard, type ShareCardTheme } from "@/components/share-card"
import { ProviderIconMask } from "@/components/provider-icon-mask"
import { Logo } from "@/components/logo"
import { ModelsGraphCard, type GraphStyle } from "@/components/models-graph-card"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import { buildShareableLines, type ShareableLine, type ShareLineScope } from "@/lib/share-lines"
import { copyCardImage } from "@/lib/share-image"
import type { ModelDisplayOptions } from "@/lib/model-breakdown-format"
import {
  ALL_SHARE_TAB_ID,
  buildModelUsage,
  formatShareGraphDateLabel,
  graphEntities,
  selectGraphEntriesByMetric,
  type GraphGroupBy,
  type GraphMetric,
  type UsagePeriod,
} from "@/lib/today-models"
import { useAppShareStore } from "@/stores/app-share-store"
import { cn } from "@/lib/utils"

const CHECKLIST_GROUPS = [
  { scope: "overview", label: "Usage" },
  { scope: "detail", label: "Details" },
  { scope: "modelBreakdown", label: "Models" },
] as const

const PRESETS = [
  { id: "summary", label: "Summary", scopes: ["overview"] },
  { id: "detailed", label: "Detailed", scopes: ["overview", "detail"] },
  { id: "models", label: "Models", scopes: ["overview", "modelBreakdown"] },
] as const satisfies readonly { id: string; label: string; scopes: readonly ShareLineScope[] }[]

type PresetId = (typeof PRESETS)[number]["id"]

// Windows the shareable graph can show. `label` is woven into headings; the
// top-right date uses formatShareGraphDateLabel for the active window.
const GRAPH_PERIODS = [
  { id: "today", tab: "Today", label: "today" },
  { id: "yesterday", tab: "Yesterday", label: "yesterday" },
  { id: "thirtyDay", tab: "30 Days", label: "30 days" },
] as const satisfies readonly { id: UsagePeriod; tab: string; label: string }[]

// The card renders (and exports) at this size; the on-screen preview scales
// down to whatever width the panel gives it.
const CARD_WIDTH_PX = 440
const FALLBACK_PREVIEW_SCALE = 0.6
const PROVIDERS_PER_ROW = 6

function chunkItems<T>(items: readonly T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size))
  }
  return chunks
}

function presetLabels(shareableLines: ShareableLine[], presetId: PresetId): Set<string> {
  const scopes = PRESETS.find((preset) => preset.id === presetId)?.scopes ?? []
  const labels = shareableLines
    .filter((entry) => (scopes as readonly ShareLineScope[]).includes(entry.scope))
    .map((entry) => entry.line.label)
  // A provider may have nothing in the preset's scopes; fall back to its
  // default-checked lines so the card is never silently empty.
  if (labels.length === 0) {
    return new Set(shareableLines.filter((entry) => entry.defaultChecked).map((entry) => entry.line.label))
  }
  return new Set(labels)
}

export type SharePageProps = {
  plugins: DisplayPluginState[]
}

type CopyState = "idle" | "copying" | "success" | "error"

export function SharePage({ plugins }: SharePageProps) {
  const shareSnapshot = useAppShareStore.getState().settings
  const patchShare = useAppShareStore((s) => s.patch)

  const [selectedId, setSelectedId] = useState<string | null>(
    shareSnapshot.selectedId ?? plugins[0]?.meta.id ?? null
  )
  const [preset, setPreset] = useState<PresetId | null>(shareSnapshot.preset)
  const [checkedLabels, setCheckedLabels] = useState<Set<string>>(new Set(shareSnapshot.checkedLabels))
  const [theme, setTheme] = useState<ShareCardTheme>(shareSnapshot.theme)
  const [showPlan, setShowPlan] = useState(shareSnapshot.showPlan)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [modelDisplay, setModelDisplay] = useState<ModelDisplayOptions>(shareSnapshot.modelDisplay)
  const [graphStyle, setGraphStyle] = useState<GraphStyle>(shareSnapshot.graphStyle)
  const [graphGroupBy, setGraphGroupBy] = useState<GraphGroupBy>(shareSnapshot.graphGroupBy)
  const [graphMetric, setGraphMetric] = useState<GraphMetric>(shareSnapshot.graphMetric)
  const [graphShowBreakdown, setGraphShowBreakdown] = useState(shareSnapshot.graphShowBreakdown)
  const [graphShowTotal, setGraphShowTotal] = useState(shareSnapshot.graphShowTotal)
  const [graphShowDate, setGraphShowDate] = useState(shareSnapshot.graphShowDate)
  // Slices the user has hidden from the graph, by entry key. Tracking the
  // hidden set (rather than the shown set) keeps new entities shown by default,
  // and makes a group-by switch a no-op since provider and model keys differ.
  const [hiddenSlices, setHiddenSlices] = useState<Set<string>>(new Set())
  const [copyState, setCopyState] = useState<CopyState>("idle")
  const [copyError, setCopyError] = useState<string | null>(null)
  const [cardHeightPx, setCardHeightPx] = useState<number | null>(null)
  const [previewWidthPx, setPreviewWidthPx] = useState<number | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const seededForRef = useRef<string | null>(shareSnapshot.selectedId)

  useEffect(() => {
    if (selectedId === ALL_SHARE_TAB_ID) return
    if (selectedId && plugins.some((plugin) => plugin.meta.id === selectedId)) return
    setSelectedId(plugins[0]?.meta.id ?? null)
  }, [plugins, selectedId])

  const selected = useMemo(
    () => plugins.find((plugin) => plugin.meta.id === selectedId) ?? null,
    [plugins, selectedId]
  )

  const isAllTab = selectedId === ALL_SHARE_TAB_ID
  const [graphPeriod, setGraphPeriod] = useState<UsagePeriod>("today")
  // All three windows so tabs know which have data. Session-local (resets to
  // Today each open), so it stays out of the persisted share store.
  const graphUsages = useMemo(
    () => ({
      today: buildModelUsage(plugins, "today"),
      yesterday: buildModelUsage(plugins, "yesterday"),
      thirtyDay: buildModelUsage(plugins, "thirtyDay"),
    }),
    [plugins]
  )
  const firstGraphPeriod = GRAPH_PERIODS.find((p) => graphUsages[p.id].totalCost > 0)?.id
  const activeGraphPeriod = graphUsages[graphPeriod].totalCost > 0 ? graphPeriod : firstGraphPeriod ?? "today"
  const graphUsage = graphUsages[activeGraphPeriod]
  const shareGraphReferenceDate = useMemo(() => new Date(), [])
  const activeGraphLabel = GRAPH_PERIODS.find((p) => p.id === activeGraphPeriod)!.label
  // Every selectable slice for the current grouping, and the subset the user
  // kept (re-normalized so what's shown fills the ring).
  const graphAllEntries = useMemo(
    () => graphEntities(graphUsage, graphGroupBy),
    [graphUsage, graphGroupBy]
  )
  const graphHasTokens = useMemo(
    () => graphAllEntries.some((entry) => entry.tokenCount != null && entry.tokenCount > 0),
    [graphAllEntries]
  )
  const activeGraphMetric =
    (graphMetric === "usage" || graphMetric === "pricePerM") && !graphHasTokens ? "price" : graphMetric
  const graphSelection = useMemo(
    () => selectGraphEntriesByMetric(graphAllEntries, activeGraphMetric, (key) => !hiddenSlices.has(key)),
    [graphAllEntries, activeGraphMetric, hiddenSlices]
  )
  const dateLabel = useMemo(
    () => formatShareGraphDateLabel(activeGraphPeriod, shareGraphReferenceDate),
    [activeGraphPeriod, shareGraphReferenceDate]
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

  // Re-seed the selection when switching providers: re-apply the active preset
  // (or Summary if the user had customized) against the new provider's lines.
  useEffect(() => {
    if (seededForRef.current === selectedId) return
    seededForRef.current = selectedId
    if (selectedId === ALL_SHARE_TAB_ID) {
      setCopyState("idle")
      setCopyError(null)
      return
    }
    const activePreset = preset ?? "summary"
    setPreset(activePreset)
    setCheckedLabels(presetLabels(shareableLines, activePreset))
    setCopyState("idle")
    setCopyError(null)
  }, [selectedId, shareableLines, preset])

  const didMountPersistRef = useRef(false)
  useEffect(() => {
    if (!didMountPersistRef.current) {
      didMountPersistRef.current = true
      return
    }
    patchShare({
      selectedId,
      preset,
      checkedLabels: Array.from(checkedLabels),
      theme,
      showPlan,
      modelDisplay,
      graphStyle,
      graphGroupBy,
      graphMetric,
      graphShowBreakdown,
      graphShowTotal,
      graphShowDate,
    })
  }, [
    patchShare,
    selectedId,
    preset,
    checkedLabels,
    theme,
    showPlan,
    modelDisplay,
    graphStyle,
    graphGroupBy,
    graphMetric,
    graphShowBreakdown,
    graphShowTotal,
    graphShowDate,
  ])

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

  // Track the card's natural size and the panel width so the preview scales to
  // fit and reserves exactly the space it paints.
  useLayoutEffect(() => {
    const card = cardRef.current
    const preview = previewRef.current
    if (!card || !preview) return
    const measure = () => {
      setCardHeightPx(card.offsetHeight || null)
      setPreviewWidthPx(preview.offsetWidth || null)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(card)
    observer.observe(preview)
    return () => observer.disconnect()
  }, [selected, isAllTab])

  const previewScale = previewWidthPx ? Math.min(1, previewWidthPx / CARD_WIDTH_PX) : FALLBACK_PREVIEW_SCALE
  const providerRows = useMemo(() => chunkItems(plugins, PROVIDERS_PER_ROW), [plugins])

  const applyPreset = (presetId: PresetId) => {
    setPreset(presetId)
    setCheckedLabels(presetLabels(shareableLines, presetId))
  }

  const setModelDisplayField = (field: keyof ModelDisplayOptions, checked: boolean) => {
    setModelDisplay((prev) => ({ ...prev, [field]: checked }))
  }

  const toggleLabel = (label: string, checked: boolean) => {
    setPreset(null)
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

  const copying = copyState === "copying"

  const copySection = (
    <section className="space-y-1.5">
      <Button
        onClick={handleCopy}
        disabled={
          copying ||
          (isAllTab ? graphSelection.entries.length === 0 : checkedLines.length === 0)
        }
        className="w-full font-semibold"
      >
        {copying ? "Copying..." : "Copy Image"}
      </Button>
      {/* Fixed-height status line so success/error doesn't shift the layout. */}
      <p
        aria-live="polite"
        className={cn(
          "min-h-5 text-center text-sm",
          copyState === "error" ? "text-destructive" : "text-muted-foreground"
        )}
      >
        {copyState === "success" ? "Copied to clipboard." : copyState === "error" ? copyError : ""}
      </p>
    </section>
  )

  return (
    <div className="py-3 space-y-4" data-testid="share-page">
      <section>
        <h3 className="text-lg font-semibold mb-0">Share Usage</h3>
        <p className="text-sm text-muted-foreground">Brag about your usage</p>
      </section>

      <section role="radiogroup" aria-label="Provider" data-testid="share-provider-radiogroup">
        <div className="bg-muted/50 rounded-lg p-1">
          <div className="space-y-1">
            <Button
              type="button"
              role="radio"
              aria-checked={isAllTab}
              aria-label="All providers"
              variant={isAllTab ? "default" : "outline"}
              size="sm"
              className="w-full"
              disabled={copying}
              data-testid="share-provider-overview-row"
              onClick={() => setSelectedId(ALL_SHARE_TAB_ID)}
            >
              <Logo aria-hidden="true" className="size-4" />
            </Button>
            {providerRows.map((row, rowIndex) => (
              <div
                key={rowIndex}
                className="grid gap-1"
                style={{ gridTemplateColumns: `repeat(${row.length}, minmax(0, 1fr))` }}
                data-testid={`share-provider-row-${rowIndex}`}
              >
                {row.map((plugin) => {
                  const isActive = plugin.meta.id === selectedId
                  return (
                    <Button
                      key={plugin.meta.id}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      aria-label={plugin.meta.name}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      className="w-full"
                      disabled={copying}
                      onClick={() => setSelectedId(plugin.meta.id)}
                    >
                      <ProviderIconMask
                        iconUrl={plugin.meta.iconUrl}
                        pluginId={plugin.meta.id}
                        sizePx={16}
                        className="bg-current"
                      />
                    </Button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </section>

      {isAllTab ? (
        !firstGraphPeriod ? (
          <p className="text-sm text-muted-foreground">No model usage recorded.</p>
        ) : (
          <>
            <section ref={previewRef} data-testid="share-page-preview">
              <div
                className="mx-auto overflow-hidden rounded-xl"
                style={{
                  width: CARD_WIDTH_PX * previewScale,
                  height: cardHeightPx !== null ? cardHeightPx * previewScale : undefined,
                }}
              >
                <div className="origin-top-left" style={{ transform: `scale(${previewScale})` }}>
                  <div ref={cardRef} className="w-fit">
                    <ModelsGraphCard
                      entries={graphSelection.entries}
                      totalCost={graphSelection.totalCost}
                      totalTokens={graphSelection.totalTokens}
                      metric={activeGraphMetric}
                      groupBy={graphGroupBy}
                      graphStyle={graphStyle}
                      theme={theme}
                      showBreakdown={graphShowBreakdown}
                      showTotal={graphShowTotal}
                      showDate={graphShowDate}
                      showWatermark
                      dateLabel={dateLabel}
                      periodLabel={activeGraphLabel}
                    />
                  </div>
                </div>
              </div>
            </section>

            <section className="space-y-2">
              <div className="bg-muted/50 rounded-lg p-1">
                <div className="flex gap-1" role="radiogroup" aria-label="Period">
                  {GRAPH_PERIODS.map((option) => {
                    const available = graphUsages[option.id].totalCost > 0
                    const isActive = option.id === activeGraphPeriod
                    return (
                      <Button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        className="flex-1"
                        disabled={copying || !available}
                        onClick={() => setGraphPeriod(option.id)}
                      >
                        {option.tab}
                      </Button>
                    )
                  })}
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-1">
                <div className="flex gap-1" role="radiogroup" aria-label="Group By">
                  {(["provider", "model"] as const).map((value) => {
                    const isActive = graphGroupBy === value
                    return (
                      <Button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        className="flex-1"
                        disabled={copying}
                        onClick={() => setGraphGroupBy(value)}
                      >
                        {value === "provider" ? "Providers" : "Models"}
                      </Button>
                    )
                  })}
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-1">
                <div className="flex gap-1" role="radiogroup" aria-label="Share">
                  {(
                    [
                      { id: "usage", label: "Usage" },
                      { id: "pricePerM", label: "Token Price" },
                      { id: "price", label: "Spend" },
                    ] as const
                  ).map((option) => {
                    const needsTokens = option.id === "usage" || option.id === "pricePerM"
                    const isActive = graphMetric === option.id
                    return (
                      <Button
                        key={option.id}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        className="flex-1"
                        disabled={copying || (needsTokens && !graphHasTokens)}
                        onClick={() => setGraphMetric(option.id)}
                      >
                        {option.label}
                      </Button>
                    )
                  })}
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-1">
                <div className="flex gap-1" role="radiogroup" aria-label="Graph Style">
                  {(["bar", "donut"] as const).map((value) => {
                    const isActive = graphStyle === value
                    return (
                      <Button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        className="flex-1"
                        disabled={copying}
                        onClick={() => setGraphStyle(value)}
                      >
                        {value === "bar" ? "Bar" : "Donut"}
                      </Button>
                    )
                  })}
                </div>
              </div>
              <div className="bg-muted/50 rounded-lg p-1">
                <div className="flex gap-1" role="radiogroup" aria-label="Card Theme">
                  {(["dark", "light"] as const).map((value) => {
                    const isActive = theme === value
                    return (
                      <Button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={isActive}
                        variant={isActive ? "default" : "outline"}
                        size="sm"
                        className="flex-1"
                        disabled={copying}
                        onClick={() => setTheme(value)}
                      >
                        {value === "dark" ? "Dark" : "Light"}
                      </Button>
                    )
                  })}
                </div>
              </div>
            </section>

            <section>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-expanded={customizeOpen}
                className="w-full justify-start gap-1 px-1 text-muted-foreground hover:text-foreground"
                onClick={() => setCustomizeOpen((open) => !open)}
              >
                <ChevronRight className={cn("size-4 transition-transform", customizeOpen && "rotate-90")} />
                Customize
              </Button>
              {customizeOpen && (
                <div className="mt-2 space-y-3" data-testid="share-graph-customize">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Display
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      <label className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
                        <Checkbox
                          aria-label="Breakdown"
                          checked={graphShowBreakdown}
                          onCheckedChange={(checked) => setGraphShowBreakdown(checked === true)}
                          disabled={copying}
                        />
                        Breakdown
                      </label>
                      <label className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
                        <Checkbox
                          aria-label="Total"
                          checked={graphShowTotal}
                          onCheckedChange={(checked) => setGraphShowTotal(checked === true)}
                          disabled={copying}
                        />
                        Total
                      </label>
                      <label className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
                        <Checkbox
                          aria-label="Dates"
                          checked={graphShowDate}
                          onCheckedChange={(checked) => setGraphShowDate(checked === true)}
                          disabled={copying}
                        />
                        Dates
                      </label>
                    </div>
                  </div>
                  {/* Choose which providers / models to show off. */}
                  <div className="flex flex-col gap-1.5" data-testid="share-graph-entities">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {graphGroupBy === "model" ? "Models" : "Providers"}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {graphAllEntries.map((entry) => (
                        <label
                          key={entry.key}
                          className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs"
                        >
                          <Checkbox
                            aria-label={entry.name}
                            checked={!hiddenSlices.has(entry.key)}
                            onCheckedChange={(checked) =>
                              setHiddenSlices((prev) => {
                                const next = new Set(prev)
                                if (checked === true) next.delete(entry.key)
                                else next.add(entry.key)
                                return next
                              })
                            }
                            disabled={copying}
                          />
                          {entry.name}
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </section>

            {copySection}
          </>
        )
      ) : !selected?.data ? (
        <p className="text-sm text-muted-foreground">No data yet for this provider.</p>
      ) : (
        <>
          <section ref={previewRef} data-testid="share-page-preview">
            {/* rounded/overflow-hidden lives on this non-exported wrapper: the
                preview shows soft corners while the copied image stays full-bleed. */}
            <div
              className="mx-auto overflow-hidden rounded-xl"
              style={{
                width: CARD_WIDTH_PX * previewScale,
                height: cardHeightPx !== null ? cardHeightPx * previewScale : undefined,
              }}
            >
              <div className="origin-top-left" style={{ transform: `scale(${previewScale})` }}>
                {/* cardRef wraps the unscaled card: the export rasterizes this
                    node, so the copied image keeps its full resolution. */}
                <div ref={cardRef} className="w-fit">
                  <ShareCard
                    providerName={selected.meta.name}
                    providerId={selected.meta.id}
                    providerIconUrl={selected.meta.iconUrl}
                    brandColor={selected.meta.brandColor ?? undefined}
                    plan={showPlan ? selected.data.plan ?? undefined : undefined}
                    lines={checkedLines}
                    theme={theme}
                    showWatermark
                    modelDisplay={modelDisplay}
                    modelBreakdownLabels={modelBreakdownLabels}
                  />
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-2">
            <div className="bg-muted/50 rounded-lg p-1">
              <div className="flex gap-1" role="radiogroup" aria-label="Card Content">
                {PRESETS.map((option) => {
                  const isActive = preset === option.id
                  return (
                    <Button
                      key={option.id}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      disabled={copying}
                      onClick={() => applyPreset(option.id)}
                    >
                      {option.label}
                    </Button>
                  )
                })}
              </div>
            </div>
            <div className="bg-muted/50 rounded-lg p-1">
              <div className="flex gap-1" role="radiogroup" aria-label="Card Theme">
                {(["dark", "light"] as const).map((value) => {
                  const isActive = theme === value
                  return (
                    <Button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={isActive}
                      variant={isActive ? "default" : "outline"}
                      size="sm"
                      className="flex-1"
                      disabled={copying}
                      onClick={() => setTheme(value)}
                    >
                      {value === "dark" ? "Dark" : "Light"}
                    </Button>
                  )
                })}
              </div>
            </div>
          </section>

          <section>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={customizeOpen}
              className="w-full justify-start gap-1 px-1 text-muted-foreground hover:text-foreground"
              onClick={() => setCustomizeOpen((open) => !open)}
            >
              <ChevronRight className={cn("size-4 transition-transform", customizeOpen && "rotate-90")} />
              Customize
            </Button>
            {customizeOpen && (
              <div className="mt-2 space-y-3" data-testid="share-customize">
                {groupedLines.map((group) => (
                  <div key={group.label} className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {group.label}
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {group.entries.map((entry) => (
                        <label
                          key={entry.line.label}
                          className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs"
                        >
                          <Checkbox
                            aria-label={entry.line.label}
                            checked={checkedLabels.has(entry.line.label)}
                            onCheckedChange={(checked) => toggleLabel(entry.line.label, checked === true)}
                            disabled={copying}
                          />
                          {entry.line.label}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}

                {hasCheckedModels && (
                  <div className="flex flex-col gap-1.5" data-testid="share-model-details-section">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Model Details
                    </span>
                    <div className="flex flex-wrap gap-1.5">
                      {(
                        [
                          ["showPercent", "Usage %"],
                          ["showToday", "Today"],
                          ["showSevenDay", "7 Days"],
                          ["showThirtyDay", "30 Days"],
                        ] as const
                      ).map(([field, label]) => (
                        <label key={field} className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
                          <Checkbox
                            aria-label={label}
                            checked={modelDisplay[field]}
                            onCheckedChange={(checked) => setModelDisplayField(field, checked === true)}
                            disabled={copying}
                          />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {selected.data.plan && (
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Card</span>
                    <div className="flex flex-wrap gap-1.5">
                      <label className="flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs">
                        <Checkbox
                          aria-label="Plan"
                          checked={showPlan}
                          onCheckedChange={(checked) => setShowPlan(checked === true)}
                          disabled={copying}
                        />
                        Plan
                      </label>
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>

          {copySection}
        </>
      )}
    </div>
  )
}
