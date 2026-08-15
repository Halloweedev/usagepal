import { ProviderCard } from "@/components/provider-card"
import type { AccountSnapshot } from "@/hooks/app/group-provider-views"
import type { PluginDisplayState } from "@/lib/plugin-types"
import type { DisplayMode, ResetTimerDisplayMode, TimeFormatMode } from "@/lib/settings"

interface ProviderDetailPageProps {
  plugin: PluginDisplayState | null
  /** Ordered account snapshots for the selected provider — drives the paginated
   * card. Falls back to `plugin`'s flat state when absent (single account). */
  accounts?: AccountSnapshot[]
  onRetry?: () => void
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  timeFormatMode?: TimeFormatMode
  onResetTimerDisplayModeToggle?: () => void
  onUsageValueToggle?: () => void
}

export function ProviderDetailPage({
  plugin,
  accounts,
  onRetry,
  displayMode,
  resetTimerDisplayMode,
  timeFormatMode = "auto",
  onResetTimerDisplayModeToggle,
  onUsageValueToggle,
}: ProviderDetailPageProps) {
  if (!plugin) {
    return (
      <div className="text-center text-muted-foreground py-8">
        Provider not found
      </div>
    )
  }

  return (
    <ProviderCard
      name={plugin.meta.name}
      links={plugin.meta.links}
      showSeparator={false}
      skeletonLines={plugin.meta.lines}
      accounts={accounts}
      onRetry={onRetry}
      scopeFilter="all"
      displayMode={displayMode}
      resetTimerDisplayMode={resetTimerDisplayMode}
      timeFormatMode={timeFormatMode}
      onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
      onUsageValueToggle={onUsageValueToggle}
    />
  )
}
