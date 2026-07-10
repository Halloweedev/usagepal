/** OKLCH color derivation for the models graph: turns a provider brand hex
 * into N in-band shade steps that stay readable on the card surface. The
 * lightness bands and chroma floor follow the values validated during design
 * (dark surface L 0.48–0.67, light surface L 0.43–0.77, chroma >= 0.11).
 * Conversion matrices are Björn Ottosson's OKLab reference implementation. */

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

/** Lightness steps within each theme's band, ordered so consecutive models of
 * the same provider get visibly different shades. Cycles past 8. */
const LIGHTNESS_STEPS: Record<GraphTheme, number[]> = {
  dark: [0.62, 0.5, 0.66, 0.54, 0.58, 0.48, 0.64, 0.52],
  light: [0.55, 0.45, 0.63, 0.49, 0.59, 0.44, 0.66, 0.52],
}

const CHROMA_MIN = 0.11
const CHROMA_MAX = 0.16
/** Below this input chroma a brand reads as monochrome (black/white/gray);
 * those get a muted slate ramp — identity then rides on the labeled list. */
const MONO_CHROMA = 0.03
const SLATE_HUE = 255
const SLATE_CHROMA = 0.045

/** Neutral in-band grays for the "Others" bucket. */
export const OTHERS_COLORS: Record<GraphTheme, string> = {
  dark: "#757575",
  light: "#8f8f8f",
}

export function deriveModelColors(brandColor: string | null, count: number, theme: GraphTheme): string[] {
  const steps = LIGHTNESS_STEPS[theme]
  const base = brandColor ? hexToOklch(brandColor) : null
  const mono = !base || base.c < MONO_CHROMA
  const hue = mono ? SLATE_HUE : base.h
  const chroma = mono ? SLATE_CHROMA : Math.min(Math.max(base.c, CHROMA_MIN), CHROMA_MAX)
  return Array.from({ length: count }, (_, index) => oklchToHex({ l: steps[index % steps.length], c: chroma, h: hue }))
}
