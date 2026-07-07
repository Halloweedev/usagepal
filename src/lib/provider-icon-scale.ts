const SMALLER_ICON_PLUGIN_IDS = new Set(["opencode-go", "cline-pass"])

/** Per-provider logo scale; OpenCode and Cline render 10% smaller. */
export function getProviderIconScale(pluginId: string | undefined): number {
  if (!pluginId) return 1
  return SMALLER_ICON_PLUGIN_IDS.has(pluginId) ? 0.9 : 1
}

export function scaleProviderIconSize(baseSizePx: number, pluginId: string | undefined): number {
  return Math.max(1, Math.round(baseSizePx * getProviderIconScale(pluginId)))
}

export function getScaledProviderIconLayout(args: {
  baseSizePx: number
  pluginId?: string
  x: number
  y: number
}): { size: number; x: number; y: number } {
  const { baseSizePx, pluginId, x, y } = args
  const size = scaleProviderIconSize(baseSizePx, pluginId)
  const offset = Math.round((baseSizePx - size) / 2)
  return { size, x: x + offset, y: y + offset }
}
