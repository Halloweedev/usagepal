import { useMemo } from "react"
import { Share2 } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { assignModelColors } from "@/components/models-graph-card"
import { useDarkMode } from "@/hooks/use-dark-mode"
import {
  ALL_SHARE_TAB_ID,
  buildTodayModelUsage,
  formatShareCost,
  formatSharePercent,
  type TodayModelEntry,
  type TodayModelsSource,
} from "@/lib/today-models"
import { useAppShareStore } from "@/stores/app-share-store"
import { useAppUiStore } from "@/stores/app-ui-store"

const LEGEND_COUNT = 3

function ModelTooltip({ model }: { model: TodayModelEntry }) {
  return (
    <div className="flex min-w-32 flex-col gap-0.5 text-xs">
      <span className="font-semibold">{model.name}</span>
      {!model.isOthers && (
        <span className="flex justify-between gap-4 text-muted-foreground">
          <span>Provider</span>
          <span className="text-foreground">{model.providerName}</span>
        </span>
      )}
      <span className="flex justify-between gap-4 text-muted-foreground">
        <span>Share today</span>
        <span className="text-foreground tabular-nums">{formatSharePercent(model.share)}</span>
      </span>
      <span className="flex justify-between gap-4 text-muted-foreground">
        <span>Price</span>
        <span className="text-foreground tabular-nums">{formatShareCost(model.todayCost)}</span>
      </span>
    </div>
  )
}

/** Compact "Models today" strip for the Overview page: minimal at rest (bar +
 * top-3 legend, no prices), details one hover away. Hidden entirely when no
 * model usage was recorded today. */
export function ModelsTodayStrip({ plugins }: { plugins: TodayModelsSource[] }) {
  const isDark = useDarkMode()
  const usage = useMemo(() => buildTodayModelUsage(plugins), [plugins])
  const theme = isDark ? ("dark" as const) : ("light" as const)
  const colors = useMemo(() => assignModelColors(usage.models, theme), [usage, theme])

  if (usage.totalCost <= 0) return null

  const openShare = () => {
    useAppShareStore.getState().patch({ selectedId: ALL_SHARE_TAB_ID })
    useAppUiStore.getState().setActiveView("share")
  }

  const modelKey = (model: TodayModelEntry) => `${model.providerId}-${model.name}`

  return (
    <div data-testid="models-today-strip" className="mb-3 rounded-xl border p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-sm font-semibold">Models today</span>
        <button
          type="button"
          aria-label="Share models graph"
          onClick={openShare}
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          <Share2 className="size-3.5" />
        </button>
      </div>
      <div className="flex h-2 gap-[2px] overflow-hidden rounded-full">
        {usage.models.map((model) => (
          <Tooltip key={modelKey(model)}>
            <TooltipTrigger
              render={
                <div
                  data-testid="strip-segment"
                  className="h-full transition-[filter] hover:brightness-125 first:rounded-l-full last:rounded-r-full"
                  style={{ width: `${model.share * 100}%`, backgroundColor: colors.get(model) }}
                />
              }
            />
            <TooltipContent side="top">
              <ModelTooltip model={model} />
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1">
        {usage.models.slice(0, LEGEND_COUNT).map((model) => (
          <Tooltip key={modelKey(model)}>
            <TooltipTrigger
              render={
                <span
                  data-testid="strip-legend-chip"
                  className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
                >
                  <span className="size-[7px] rounded-[2px]" style={{ backgroundColor: colors.get(model) }} />
                  {model.name} {formatSharePercent(model.share)}
                </span>
              }
            />
            <TooltipContent side="top">
              <ModelTooltip model={model} />
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}
