/** Per-provider logo scale relative to the shared base size. */
const PROVIDER_ICON_SCALES: Record<string, number> = {
  "opencode-go": 0.9,
  "cline-pass": 0.9,
  amp: 0.8,
}

/** Per-provider logo scale; OpenCode/Cline are 10% smaller, Amp is 20% smaller. */
export function getProviderIconScale(pluginId: string | undefined): number {
  if (!pluginId) return 1
  return PROVIDER_ICON_SCALES[pluginId] ?? 1
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
