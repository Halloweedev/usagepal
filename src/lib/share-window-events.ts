import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"

/** Main window → share window: the current display plugins snapshot. */
export const SHARE_PLUGINS_UPDATED = "share:plugins-updated"

/** Share window → main window: emitted on mount so the main app resends data. */
export const SHARE_READY = "share:ready"

export type SharePluginsUpdatedPayload = DisplayPluginState[]
