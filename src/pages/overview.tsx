import { ModelsTodayStrip } from "@/components/models-today-strip"
import { ProviderCard } from "@/components/provider-card"
import type { PluginDisplayState } from "@/lib/plugin-types"
import type { DisplayMode, ResetTimerDisplayMode, TimeFormatMode } from "@/lib/settings"

interface OverviewPageProps {
  plugins: PluginDisplayState[]
  onRetryPlugin?: (pluginId: string) => void
  displayMode: DisplayMode
  resetTimerDisplayMode: ResetTimerDisplayMode
  timeFormatMode?: TimeFormatMode
  overviewSpendStripEnabled?: boolean
  onResetTimerDisplayModeToggle?: () => void
  onUsageValueToggle?: () => void
}

export function OverviewPage({
  plugins,
  onRetryPlugin,
  displayMode,
  resetTimerDisplayMode,
  timeFormatMode = "auto",
  overviewSpendStripEnabled = true,
  onResetTimerDisplayModeToggle,
  onUsageValueToggle,
}: OverviewPageProps) {
  return (
    <div className="pb-3">
      {plugins.length === 0 ? (
        <div className="text-center text-muted-foreground py-8">
          No providers enabled
        </div>
      ) : (
        <>
          {overviewSpendStripEnabled && (
            <section className="mb-3 pt-2">
              <h3 className="text-lg font-semibold mb-2">Quick Usage Overview</h3>
              <ModelsTodayStrip plugins={plugins} />
            </section>
          )}
          {plugins.map((plugin, index) => (
            <ProviderCard
              key={plugin.meta.id}
              name={plugin.meta.name}
              plan={plugin.data?.plan ?? undefined}
              asCard
              iconUrl={plugin.meta.iconUrl}
              pluginId={plugin.meta.id}
              showSeparator={index < plugins.length - 1}
              loading={plugin.loading}
              error={plugin.error}
              lines={plugin.data?.lines ?? []}
              skeletonLines={plugin.meta.lines}
              lastManualRefreshAt={plugin.lastManualRefreshAt}
              lastUpdatedAt={plugin.lastUpdatedAt}
              onRetry={onRetryPlugin ? () => onRetryPlugin(plugin.meta.id) : undefined}
              scopeFilter="overview"
              displayMode={displayMode}
              resetTimerDisplayMode={resetTimerDisplayMode}
              timeFormatMode={timeFormatMode}
              onResetTimerDisplayModeToggle={onResetTimerDisplayModeToggle}
              onUsageValueToggle={onUsageValueToggle}
            />
          ))}
        </>
      )}
    </div>
  )
}
