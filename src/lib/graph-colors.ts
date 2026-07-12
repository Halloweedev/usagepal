/** OKLCH color derivation for the models graph: turns a provider brand hex
 * into readable slice colors. Provider slices stay on-brand; monochrome brands
 * (black/white/gray) fan out across a spaced hue ramp so they don't collide.
 * Model slices spread hue and lightness so every entry reads as its own color.
 * Conversion matrices are Björn Ottosson's OKLab reference implementation. */

import type { GraphGroupBy } from "@/lib/today-models"

export type Oklch = { l: number; c: number; h: number }

type GraphTheme = "dark" | "light"

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(channel: number): number {
  return channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
}

export function hexToOklch(hex: string): Oklch | null {
  let value = hex.startsWith("#") ? hex.slice(1) : hex
  if (value.length === 3) value = value[0] + value[0] + value[1] + value[1] + value[2] + value[2]
  if (value.length === 8) value = value.slice(0, 6)
  if (!/^[0-9a-fA-F]{6}$/.test(value)) return null
  const r = srgbToLinear(parseInt(value.slice(0, 2), 16) / 255)
  const g = srgbToLinear(parseInt(value.slice(2, 4), 16) / 255)
  const b = srgbToLinear(parseInt(value.slice(4, 6), 16) / 255)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  return {
    l: lightness,
    c: Math.sqrt(a * a + bb * bb),
    h: (Math.atan2(bb, a) * (180 / Math.PI) + 360) % 360,
  }
}

export function oklchToHex({ l, c, h }: Oklch): string {
  const rad = h * (Math.PI / 180)
  const a = c * Math.cos(rad)
  const b = c * Math.sin(rad)
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3
  const r = 4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_
  const g = -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_
  const bl = -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_
  const toHex = (channel: number) =>
    Math.round(clamp01(linearToSrgb(channel)) * 255)
      .toString(16)
      .padStart(2, "0")
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`
}

/** Wide lightness ladder — consecutive picks are at least ~0.10 apart in L. */
const LIGHTNESS_STEPS: Record<GraphTheme, number[]> = {
  dark: [0.72, 0.50, 0.78, 0.44, 0.66, 0.54, 0.74, 0.46],
  light: [0.44, 0.66, 0.40, 0.72, 0.48, 0.60, 0.42, 0.68],
}

/** Hue nudges from the brand anchor so same-provider models don't read as one shade. */
const HUE_OFFSETS = [0, 34, -30, 52, -44, 22, -58, 40]

const CHROMA_MIN = 0.13
const CHROMA_MAX = 0.24
/** Below this input chroma a brand reads as monochrome (black/white/gray);
 * those get a spaced hue ramp so multiple black-logo providers stay distinct. */
const MONO_CHROMA = 0.03
/** Chroma for mono provider slices — high enough to tell them apart, low enough
 * not to invent a fake brand color. */
const MONO_PROVIDER_CHROMA = 0.11
/** Well-spaced hues for monochrome brand providers other than Cursor
 * (OpenCode Go, ClinePass, Grok, …). Cursor alone stays pure black. */
const MONO_PROVIDER_HUES = [250, 30, 145, 310, 85, 200, 15, 175] as const
const SLATE_HUE = 255
const SLATE_CHROMA = 0.05

/** Cursor is the only provider rendered as pure black. */
export const CURSOR_PROVIDER_COLOR = "#000000"

/** Neutral in-band grays for the "Others" bucket. */
export const OTHERS_COLORS: Record<GraphTheme, string> = {
  dark: "#757575",
  light: "#8f8f8f",
}

function clampLightness(l: number, theme: GraphTheme): number {
  return theme === "dark" ? Math.min(Math.max(l, 0.42), 0.80) : Math.min(Math.max(l, 0.38), 0.76)
}

export function isMonoBrandColor(brandColor: string | null): boolean {
  const base = brandColor ? hexToOklch(brandColor) : null
  return !base || base.c < MONO_CHROMA
}

function canonicalizeHex(hex: string): string {
  const value = hex.startsWith("#") ? hex.slice(1) : hex
  return `#${value.slice(0, 6).toLowerCase()}`
}

/** One on-brand provider accent — hue locked to the brand, chroma boosted.
 * Monochrome brands take `monoRank` so several black logos don't share a slice color.
 * Cursor is handled separately as {@link CURSOR_PROVIDER_COLOR}. */
export function deriveProviderColor(brandColor: string | null, theme: GraphTheme, monoRank = 0): string {
  const base = brandColor ? hexToOklch(brandColor) : null
  if (!base || base.c < MONO_CHROMA) {
    const h = MONO_PROVIDER_HUES[monoRank % MONO_PROVIDER_HUES.length]
    const l = LIGHTNESS_STEPS[theme][monoRank % LIGHTNESS_STEPS[theme].length]
    return oklchToHex({ l, c: MONO_PROVIDER_CHROMA, h })
  }
  const l = clampLightness(base.l, theme)
  const c = Math.min(Math.max(base.c, CHROMA_MIN), CHROMA_MAX)
  return oklchToHex({ l, c, h: base.h })
}

/** A model slice color: brand-anchored hue with rank-based hue/lightness spread. */
export function deriveDistinctModelColor(brandColor: string | null, rank: number, theme: GraphTheme): string {
  const base = brandColor ? hexToOklch(brandColor) : null
  const mono = !base || base.c < MONO_CHROMA
  const brandHue = mono ? SLATE_HUE : base.h
  const hue = (brandHue + HUE_OFFSETS[rank % HUE_OFFSETS.length] + 360) % 360
  const l = LIGHTNESS_STEPS[theme][rank % LIGHTNESS_STEPS[theme].length]
  const chroma = mono ? SLATE_CHROMA : Math.min(Math.max(base.c, CHROMA_MIN), CHROMA_MAX)
  return oklchToHex({ l, c: chroma, h: hue })
}

/** Back-compat wrapper used where a provider needs N in-band steps. */
export function deriveModelColors(brandColor: string | null, count: number, theme: GraphTheme): string[] {
  return Array.from({ length: count }, (_, index) => deriveDistinctModelColor(brandColor, index, theme))
}

export type GraphColorEntry = {
  key: string
  brandColor: string | null
  isOthers?: boolean
}

/** Colors for graph/strip slices. Provider mode keeps brand hues; Cursor is
 * pure black (alone); other mono brands fan out. Model mode walks the ranked
 * list so every model gets a globally distinct shade. */
export function assignGraphEntryColors(
  entries: GraphColorEntry[],
  groupBy: GraphGroupBy,
  theme: GraphTheme
): Map<string, string> {
  const colors = new Map<string, string>()
  if (groupBy === "provider") {
    let monoRank = 0
    for (const entry of entries) {
      if (entry.isOthers) {
        colors.set(entry.key, OTHERS_COLORS[theme])
        continue
      }
      if (entry.key === "cursor") {
        colors.set(entry.key, CURSOR_PROVIDER_COLOR)
        continue
      }
      // Claude / Codex / other chromatic brands: keep the brand hex as-is so
      // orange and teal stay exactly on-brand (no OKLCH remix).
      if (entry.brandColor && !isMonoBrandColor(entry.brandColor)) {
        colors.set(entry.key, canonicalizeHex(entry.brandColor))
        continue
      }
      colors.set(entry.key, deriveProviderColor(entry.brandColor, theme, monoRank))
      monoRank += 1
    }
    return colors
  }

  let rank = 0
  for (const entry of entries) {
    if (entry.isOthers) {
      colors.set(entry.key, OTHERS_COLORS[theme])
      continue
    }
    colors.set(entry.key, deriveDistinctModelColor(entry.brandColor, rank, theme))
    rank += 1
  }
  return colors
}
