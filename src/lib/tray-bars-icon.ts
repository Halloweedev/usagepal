import { Image } from "@tauri-apps/api/image"
import { getScaledProviderIconLayout } from "@/lib/provider-icon-scale"
import type { MenubarIconStyle } from "@/lib/settings"
import type { TrayPrimaryBar } from "@/lib/tray-primary-progress"

const PROVIDER_ICON_SHRINK_PX = -2
const PROVIDER_ICON_VERTICAL_NUDGE_PX = 0
/** Bar slot count used to derive track height in the standard 4-bar menubar icon. */
const BARS_STYLE_SLOT_COUNT = 4
const BARS_TRACK_OPACITY = 0.16
const BARS_REMAINDER_OPACITY = 0.24
const BARS_FILL_OPACITY = 1

function rgbaToImageDataBytes(rgba: Uint8ClampedArray): Uint8Array {
  // Image.new expects Uint8Array. Uint8ClampedArray shares the same buffer layout.
  return new Uint8Array(rgba.buffer)
}

function escapeXmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}

function makeRoundedBarPath(args: {
  x: number
  y: number
  w: number
  h: number
  leftRadius: number
  rightRadius: number
}): string {
  const { x, y, w, h } = args
  const leftRadius = Math.max(0, Math.min(args.leftRadius, h / 2, w / 2))
  const rightRadius = Math.max(0, Math.min(args.rightRadius, h / 2, w / 2))
  const x1 = x + w
  const y1 = y + h
  return [
    `M ${x + leftRadius} ${y}`,
    `L ${x1 - rightRadius} ${y}`,
    `A ${rightRadius} ${rightRadius} 0 0 1 ${x1} ${y + rightRadius}`,
    `L ${x1} ${y1 - rightRadius}`,
    `A ${rightRadius} ${rightRadius} 0 0 1 ${x1 - rightRadius} ${y1}`,
    `L ${x + leftRadius} ${y1}`,
    `A ${leftRadius} ${leftRadius} 0 0 1 ${x} ${y1 - leftRadius}`,
    `L ${x} ${y + leftRadius}`,
    `A ${leftRadius} ${leftRadius} 0 0 1 ${x + leftRadius} ${y}`,
    "Z",
  ].join(" ")
}

function getMinVisibleRemainderPx(trackW: number): number {
  // Keep a thin but visible tail on near-full (yet sub-threshold) bars so they
  // still read as "not quite full", while surviving tray downsampling.
  return Math.max(2, Math.round(trackW * 0.05))
}

/** At or above this fill, a bar reads as completely full (no tail). */
const BAR_FULL_THRESHOLD = 0.97

function getVisualBarFraction(fraction: number): number {
  if (!Number.isFinite(fraction)) return 0
  const clamped = Math.max(0, Math.min(1, fraction))
  // Treat a near-maxed metric as full so it reads as maxed in the tiny tray
  // icon; below the threshold render the true fraction (the min-remainder floor
  // keeps a thin visible tail so just-below-full values still look not-full).
  return clamped >= BAR_FULL_THRESHOLD ? 1 : clamped
}

export function getBarFillLayout(trackW: number, fraction: number): {
  fillW: number
  remainderDrawW: number
  dividerX: number | null
} {
  if (!Number.isFinite(fraction) || fraction <= 0) {
    return { fillW: 0, remainderDrawW: 0, dividerX: null }
  }

  const visual = getVisualBarFraction(fraction)
  if (visual >= 1) {
    return { fillW: trackW, remainderDrawW: 0, dividerX: null }
  }

  const minVisibleRemainderPx = getMinVisibleRemainderPx(trackW)
  const maxFillW = Math.max(1, trackW - minVisibleRemainderPx)
  const fillW = Math.max(1, Math.min(maxFillW, Math.round(trackW * visual)))
  const trueRemainderW = trackW - fillW
  const remainderDrawW = Math.min(trackW - 1, Math.max(trueRemainderW, minVisibleRemainderPx))
  const dividerX = trackW - remainderDrawW
  return { fillW, remainderDrawW, dividerX }
}

export function getBarsStyleTrackLayout(
  sizePx: number,
  barSlotCount = BARS_STYLE_SLOT_COUNT,
): {
  pad: number
  gap: number
  trackW: number
  trackH: number
  rx: number
  barsX: number
} {
  const pad = Math.max(1, Math.round(sizePx * 0.08))
  const gap = Math.max(1, Math.round(sizePx * 0.03))
  const trackW = sizePx - 2 * pad
  const layoutN = Math.max(2, barSlotCount)
  const trackH = Math.max(
    1,
    Math.floor((sizePx - 2 * pad - (layoutN - 1) * gap) / layoutN),
  )
  const rx = Math.max(1, Math.floor(trackH / 3))
  return { pad, gap, trackW, trackH, rx, barsX: pad }
}

function getStackedBarYs(args: {
  sizePx: number
  pad: number
  trackH: number
  gap: number
  barCount: number
}): number[] {
  const { sizePx, pad, trackH, gap, barCount } = args
  const totalStackHeight = barCount * trackH + (barCount - 1) * gap
  const availableHeight = sizePx - 2 * pad
  const yOffset = pad + Math.floor((availableHeight - totalStackHeight) / 2)
  return Array.from({ length: barCount }, (_, i) => yOffset + i * (trackH + gap) + 1)
}

function appendTrayBarTrack(
  parts: string[],
  args: {
    x: number
    y: number
    trackW: number
    trackH: number
    rx: number
    fraction?: number
  },
): void {
  const { x, y, trackW, trackH, rx, fraction } = args
  const trackOpacity = BARS_TRACK_OPACITY
  const remainderOpacity = BARS_REMAINDER_OPACITY
  const fillOpacity = BARS_FILL_OPACITY

  parts.push(
    `<rect x="${x}" y="${y}" width="${trackW}" height="${trackH}" rx="${rx}" fill="black" opacity="${trackOpacity}" />`
  )

  if (typeof fraction !== "number" || !Number.isFinite(fraction) || fraction < 0) return

  const { fillW, remainderDrawW, dividerX } = getBarFillLayout(trackW, fraction)
  if (fillW > 0) {
    const movingEdgeRadius = Math.max(0, Math.floor(rx * 0.35))
    if (fillW >= trackW) {
      parts.push(
        `<rect x="${x}" y="${y}" width="${fillW}" height="${trackH}" rx="${rx}" fill="black" opacity="${fillOpacity}" />`
      )
    } else {
      const fillPath = makeRoundedBarPath({
        x,
        y,
        w: fillW,
        h: trackH,
        leftRadius: rx,
        rightRadius: movingEdgeRadius,
      })
      parts.push(`<path d="${fillPath}" fill="black" opacity="${fillOpacity}" />`)
    }
  }

  if (fillW > 0 && remainderDrawW > 0 && dividerX !== null) {
    const remainderX = x + dividerX
    const remainderPath = makeRoundedBarPath({
      x: remainderX,
      y,
      w: remainderDrawW,
      h: trackH,
      leftRadius: Math.max(0, Math.floor(rx * 0.2)),
      rightRadius: rx,
    })
    parts.push(`<path d="${remainderPath}" fill="black" opacity="${remainderOpacity}" />`)
  }
}

function normalizePercentText(percentText: string | undefined): string | undefined {
  if (typeof percentText !== "string") return undefined
  const trimmed = percentText.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function estimateTextWidthPx(text: string, fontSize: number): number {
  // Empirical estimate for SF Pro bold numeric glyphs in tray-sized icons.
  return Math.ceil(text.length * fontSize * 0.62 + fontSize * 0.2)
}

function getSvgLayout(args: {
  sizePx: number
  style: MenubarIconStyle
  percentText?: string
  secondaryPercentText?: string
  compact?: boolean
  providerDisplayMode?: "percent" | "bars"
}): {
  width: number
  height: number
  pad: number
  gap: number
  barsX: number
  barsWidth: number
  textX: number
  textY: number
  textYTop?: number
  textYBottom?: number
  fontSize: number
  primaryFontSize?: number
  secondaryFontSize?: number
  miniBarTrackW?: number
  miniBarTrackH?: number
  miniBarGap?: number
  miniBarX?: number
  miniBarYTop?: number
  miniBarYBottom?: number
} {
  const {
    sizePx,
    style,
    percentText,
    secondaryPercentText,
    compact = false,
    providerDisplayMode = "percent",
  } = args
  const topText = normalizePercentText(percentText)
  const bottomText = normalizePercentText(secondaryPercentText)
  const hasTopText = typeof topText === "string" && topText.length > 0
  const hasBottomText = typeof bottomText === "string" && bottomText.length > 0
  const hasAnyText = hasTopText || hasBottomText
  const hasDualText = hasTopText && hasBottomText
  const forceDualLineTypography = compact || hasDualText
  const verticalNudgePx = 1
  const pad = Math.max(1, Math.round(sizePx * 0.08)) // ~2px at 24–36px
  const gap = Math.max(1, Math.round(sizePx * 0.03)) // ~1px at 36px

  const height = sizePx
  const barsX = pad
  const barsWidth = sizePx - 2 * pad
  const fontSize = Math.max(9, Math.round(sizePx * 0.72))
  const primaryFontSize = forceDualLineTypography ? Math.max(9, Math.round(sizePx * 0.55)) : fontSize
  const secondaryFontSize = forceDualLineTypography ? Math.max(8, Math.round(sizePx * 0.45)) : fontSize
  const textYTop = forceDualLineTypography ? Math.round(sizePx * 0.30) + verticalNudgePx : undefined
  const textYBottom = forceDualLineTypography ? Math.round(sizePx * 0.76) + verticalNudgePx : undefined
  const textWidth = hasAnyText
    ? Math.max(
        hasTopText ? estimateTextWidthPx(topText!, forceDualLineTypography ? primaryFontSize : fontSize) : 0,
        hasBottomText ? estimateTextWidthPx(bottomText!, forceDualLineTypography ? secondaryFontSize : fontSize) : 0,
      )
    : 0
  // Optical correction + global nudge down to align with the tray slot center.
  const textY = Math.round(sizePx / 2) + 1 + verticalNudgePx

  if (style === "donut") {
    const donutGap = Math.max(1, Math.round(sizePx * 0.06))
    return {
      width: sizePx + donutGap + sizePx,
      height,
      pad,
      gap,
      barsX,
      barsWidth,
      textX: 0,
      textY,
      fontSize,
    }
  }

  if (style === "provider") {
    const showBars = compact && providerDisplayMode === "bars"
    const hasText = !showBars && hasAnyText
    const barsLayout = getBarsStyleTrackLayout(sizePx)
    const miniBarTrackW = barsLayout.trackW
    const miniBarTrackH = barsLayout.trackH
    const miniBarGap = barsLayout.gap
    const contentAreaWidth = showBars
      ? miniBarTrackW
      : hasText
        ? compact
          ? Math.max(14, textWidth + Math.max(1, Math.round(pad * 0.5)))
          : Math.max(20, Math.round(sizePx * 1.5), textWidth + pad)
        : 0

    if (!hasText && !showBars) {
      return {
        width: sizePx,
        height,
        pad,
        gap,
        barsX,
        barsWidth,
        textX: 0,
        textY,
        fontSize,
      }
    }

    const textGap = compact
      ? Math.max(1, Math.round(sizePx * 0.04))
      : Math.max(2, Math.round(sizePx * 0.08))
    const rightPad = compact ? Math.max(1, Math.round(pad * 0.5)) : pad
    const contentX = sizePx + textGap
    const [miniBarYTop, miniBarYBottom] = getStackedBarYs({
      sizePx,
      pad: barsLayout.pad,
      trackH: miniBarTrackH,
      gap: miniBarGap,
      barCount: 2,
    })

    return {
      width: sizePx + textGap + contentAreaWidth + rightPad,
      height,
      pad,
      gap,
      barsX,
      barsWidth,
      textX: contentX,
      textY,
      textYTop,
      textYBottom,
      fontSize,
      primaryFontSize,
      secondaryFontSize,
      miniBarTrackW: showBars ? miniBarTrackW : undefined,
      miniBarTrackH: showBars ? miniBarTrackH : undefined,
      miniBarGap: showBars ? miniBarGap : undefined,
      miniBarX: showBars ? contentX : undefined,
      miniBarYTop: showBars ? miniBarYTop : undefined,
      miniBarYBottom: showBars ? miniBarYBottom : undefined,
    }
  }

  if (!hasAnyText) {
    return {
      width: sizePx,
      height,
      pad,
      gap,
      barsX,
      barsWidth,
      textX: 0,
      textY,
      fontSize,
    }
  }

  const textGap = Math.max(2, Math.round(sizePx * 0.08))
  const textAreaWidth = Math.max(20, Math.round(sizePx * 1.5), textWidth + pad)
  const rightPad = pad

  return {
    width: sizePx + textGap + textAreaWidth + rightPad,
    height,
    pad,
    gap,
    barsX,
    barsWidth,
    textX: sizePx + textGap,
    textY,
    fontSize,
  }
}

export function makeTrayBarsSvg(args: {
  bars: TrayPrimaryBar[]
  sizePx: number
  style?: MenubarIconStyle
  percentText?: string
  secondaryPercentText?: string
  providerIconUrl?: string
  providerId?: string
  compact?: boolean
  providerDisplayMode?: "percent" | "bars"
  sessionFraction?: number
  weeklyFraction?: number
  /** Multi-tray: force canvas width so every provider slot is identical. */
  slotWidth?: number
}): string {
  const {
    bars,
    sizePx,
    style = "provider",
    percentText,
    secondaryPercentText,
    providerIconUrl,
    providerId,
    compact = false,
    providerDisplayMode = "percent",
    sessionFraction,
    weeklyFraction,
    slotWidth,
  } = args
  const barsForStyle = style === "bars" ? bars : bars.slice(0, 1)
  // Intentionally render a single empty track when bars mode has no data yet
  // so the tray icon keeps a stable shape during loading/initialization.
  const n = Math.max(1, Math.min(4, barsForStyle.length || 1))
  const top = normalizePercentText(percentText)
  const bottom = normalizePercentText(secondaryPercentText)
  const layout = getSvgLayout({
    sizePx,
    style,
    percentText: top,
    secondaryPercentText: bottom,
    compact,
    providerDisplayMode,
  })
  if (typeof slotWidth === "number" && slotWidth > 0) {
    layout.width = slotWidth
  }

  const width = layout.width
  const height = layout.height
  const trackW = layout.barsWidth

  const parts: string[] = []
  parts.push(
    `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`
  )

  if (style === "provider") {
    const showBars = compact && providerDisplayMode === "bars"
    const hasText = !showBars && Boolean(top || bottom)
    const baseIconSize = Math.max(6, Math.round(sizePx - 2 * layout.pad * 0.5) - ((hasText || showBars) ? PROVIDER_ICON_SHRINK_PX : 0))
    const baseX = layout.barsX
    const baseY = Math.round((height - baseIconSize) / 2) + ((hasText || showBars) ? PROVIDER_ICON_VERTICAL_NUDGE_PX : 0)
    const { size: iconSize, x, y } = getScaledProviderIconLayout({
      baseSizePx: baseIconSize,
      pluginId: providerId,
      x: baseX,
      y: baseY,
    })
    const href = typeof providerIconUrl === "string" ? providerIconUrl.trim() : ""

    if (href.length > 0) {
      parts.push(
        `<image x="${x}" y="${y}" width="${iconSize}" height="${iconSize}" href="${escapeXmlText(href)}" preserveAspectRatio="xMidYMid meet" />`
      )
    } else {
      const cx = x + iconSize / 2
      const cy = y + iconSize / 2
      const radius = Math.max(2, iconSize / 2 - 1.5)
      const strokeW = Math.max(1.5, Math.round(iconSize * 0.14))
      parts.push(
        `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="black" stroke-width="${strokeW}" opacity="1" shape-rendering="geometricPrecision" />`
      )
    }

    if (showBars && layout.miniBarX != null && layout.miniBarTrackW != null && layout.miniBarTrackH != null) {
      const barX = layout.miniBarX
      const trackW = layout.miniBarTrackW
      const trackH = layout.miniBarTrackH
      const barsLayout = getBarsStyleTrackLayout(sizePx)
      const topY = layout.miniBarYTop ?? layout.textYTop ?? layout.textY
      const bottomY = layout.miniBarYBottom ?? layout.textYBottom ?? layout.textY

      appendTrayBarTrack(parts, {
        x: barX,
        y: topY,
        trackW,
        trackH,
        rx: barsLayout.rx,
        fraction: sessionFraction,
      })
      appendTrayBarTrack(parts, {
        x: barX,
        y: bottomY,
        trackW,
        trackH,
        rx: barsLayout.rx,
        fraction: weeklyFraction,
      })
    } else {
      if (top) {
        parts.push(
          `<text x="${layout.textX}" y="${layout.textYTop ?? layout.textY}" fill="black" font-family="-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif" font-size="${layout.primaryFontSize ?? layout.fontSize}" font-weight="700" dominant-baseline="middle">${escapeXmlText(top)}</text>`
        )
      }
      if (bottom) {
        parts.push(
          `<text x="${layout.textX}" y="${layout.textYBottom ?? layout.textY}" fill="black" font-family="-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif" font-size="${layout.secondaryFontSize ?? layout.fontSize}" font-weight="700" dominant-baseline="middle" opacity="0.7">${escapeXmlText(bottom)}</text>`
        )
      }
    }
  } else if (style === "donut") {
    const baseIconSize = Math.max(6, Math.round(sizePx - 2 * layout.pad * 0.5))
    const baseIconX = layout.barsX
    const baseIconY = Math.round((height - baseIconSize) / 2)
    const { size: iconSize, x: iconX, y: iconY } = getScaledProviderIconLayout({
      baseSizePx: baseIconSize,
      pluginId: providerId,
      x: baseIconX,
      y: baseIconY,
    })
    const href = typeof providerIconUrl === "string" ? providerIconUrl.trim() : ""

    if (href.length > 0) {
      parts.push(
        `<image x="${iconX}" y="${iconY}" width="${iconSize}" height="${iconSize}" href="${escapeXmlText(href)}" preserveAspectRatio="xMidYMid meet" />`
      )
    } else {
      const fcx = iconX + iconSize / 2
      const fcy = iconY + iconSize / 2
      const fallbackR = Math.max(2, iconSize / 2 - 1.5)
      const fallbackSW = Math.max(1.5, Math.round(iconSize * 0.14))
      parts.push(
        `<circle cx="${fcx}" cy="${fcy}" r="${fallbackR}" fill="none" stroke="black" stroke-width="${fallbackSW}" opacity="1" shape-rendering="geometricPrecision" />`
      )
    }

    const donutGap = Math.max(1, Math.round(sizePx * 0.06))
    const donutAreaX = sizePx + donutGap
    const chartSize = Math.max(6, sizePx - 2 * layout.pad)
    const cx = donutAreaX + layout.pad + chartSize / 2
    const cy = height / 2 + 1
    const strokeW = Math.max(2, Math.round(chartSize * 0.16))
    const radius = Math.max(1, Math.floor(chartSize / 2 - strokeW / 2) + 0.5)

    parts.push(
      `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="black" stroke-width="${strokeW}" opacity="${BARS_TRACK_OPACITY}" shape-rendering="geometricPrecision" />`
    )

    const fraction = barsForStyle[0]?.fraction
    if (typeof fraction === "number" && Number.isFinite(fraction) && fraction >= 0) {
      const clamped = Math.max(0, Math.min(1, fraction))
      if (clamped > 0) {
        const circumference = 2 * Math.PI * radius
        const dash = circumference * clamped
        parts.push(
          `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="none" stroke="black" stroke-width="${strokeW}" stroke-linecap="butt" stroke-dasharray="${dash} ${circumference}" transform="rotate(-90 ${cx} ${cy})" opacity="${BARS_FILL_OPACITY}" shape-rendering="geometricPrecision" />`
        )
      }
    }
  } else {
    // style === "bars"
    const barsLayout = getBarsStyleTrackLayout(sizePx, n)
    const { trackH, rx } = barsLayout
    const barYs = getStackedBarYs({
      sizePx,
      pad: layout.pad,
      trackH,
      gap: layout.gap,
      barCount: n,
    })

    for (let i = 0; i < n; i += 1) {
      const bar = barsForStyle[i]
      appendTrayBarTrack(parts, {
        x: layout.barsX,
        y: barYs[i]!,
        trackW,
        trackH,
        rx,
        fraction: bar?.fraction,
      })
    }
  }

  if (top && style !== "provider") {
    parts.push(
      `<text x="${layout.textX}" y="${layout.textY}" fill="black" font-family="-apple-system,BlinkMacSystemFont,'SF Pro Text',sans-serif" font-size="${layout.fontSize}" font-weight="700" dominant-baseline="middle">${escapeXmlText(top)}</text>`
    )
  }

  parts.push(`</svg>`)
  return parts.join("")
}

async function rasterizeSvgToRgba(svg: string, widthPx: number, heightPx: number): Promise<Uint8Array> {
  const blob = new Blob([svg], { type: "image/svg+xml" })
  const url = URL.createObjectURL(blob)
  try {
    const img = new window.Image()
    img.decoding = "async"

    const loaded = new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error("Failed to load SVG into image"))
    })

    img.src = url
    await loaded

    const canvas = document.createElement("canvas")
    canvas.width = widthPx
    canvas.height = heightPx

    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("Canvas 2D context missing")

    // Clear to transparent; template icons use alpha as mask.
    ctx.clearRect(0, 0, widthPx, heightPx)
    ctx.drawImage(img, 0, 0, widthPx, heightPx)

    const imageData = ctx.getImageData(0, 0, widthPx, heightPx)
    return rgbaToImageDataBytes(imageData.data)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function extractSvgInnerContent(svg: string): string {
  const match = svg.match(/<svg[^>]*>([\s\S]*)<\/svg>/)
  return match?.[1] ?? ""
}

export type MultiTrayProviderIcon = {
  id?: string
  iconUrl?: string
  sessionText?: string
  weeklyText?: string
  sessionFraction?: number
  weeklyFraction?: number
}

const MULTI_TRAY_PROVIDER_GAP_RATIO = 0.1
/** Maximum providers rendered in one composite tray icon. */
export const MULTI_TRAY_MAX_PROVIDERS = 4

export function getMultiTrayProviderGap(sizePx: number): number {
  return Math.max(4, Math.round(sizePx * MULTI_TRAY_PROVIDER_GAP_RATIO))
}

export function getMultiTraySvgLayout(args: {
  providers: MultiTrayProviderIcon[]
  sizePx: number
  compact?: boolean
  maxProviders?: number
  displayMode?: "percent" | "bars"
}): {
  width: number
  height: number
  providerWidths: number[]
  slotCount: number
} {
  const {
    providers,
    sizePx,
    compact = true,
    maxProviders = MULTI_TRAY_MAX_PROVIDERS,
    displayMode = "percent",
  } = args
  const gap = getMultiTrayProviderGap(sizePx)
  // Keep each provider slot width fixed in multi mode so tray item width stays
  // stable even when values are temporarily missing or text length changes.
  const fixedProviderWidth = getSvgLayout({
    sizePx,
    style: "provider",
    percentText: "100%",
    secondaryPercentText: "100%",
    compact,
    providerDisplayMode: displayMode,
  }).width
  const slotCount = Math.max(1, Math.min(providers.length, maxProviders))
  const providerWidths = Array.from({ length: slotCount }, () => fixedProviderWidth)
  const contentWidth =
    providerWidths.reduce((sum, providerWidth) => sum + providerWidth, 0) +
    Math.max(0, slotCount - 1) * gap
  const canvasWidth = Math.max(sizePx, contentWidth)
  return {
    width: canvasWidth,
    height: sizePx,
    providerWidths,
    slotCount,
  }
}

// macOS places each NSStatusItem independently, so multi mode renders all
// providers in one wide composite icon instead of separate tray items.
export function makeMultiTrayBarsSvg(args: {
  providers: MultiTrayProviderIcon[]
  sizePx: number
  compact?: boolean
  displayMode?: "percent" | "bars"
}): string {
  const { providers, sizePx, compact = true, displayMode = "percent" } = args
  if (providers.length === 0) {
    return makeTrayBarsSvg({ bars: [], sizePx, style: "provider", compact, providerDisplayMode: displayMode })
  }

  const gap = getMultiTrayProviderGap(sizePx)
  const layout = getMultiTraySvgLayout({ providers, sizePx, compact, displayMode })
  const slotWidth = layout.providerWidths[0] ?? sizePx
  const groups: string[] = []

  for (let i = 0; i < providers.length; i += 1) {
    const provider = providers[i]
    if (!provider) continue

    const providerSvg = makeTrayBarsSvg({
      bars: [],
      sizePx,
      style: "provider",
      percentText: provider.sessionText,
      secondaryPercentText: provider.weeklyText,
      providerIconUrl: provider.iconUrl,
      providerId: provider.id,
      compact,
      providerDisplayMode: displayMode,
      sessionFraction: provider.sessionFraction,
      weeklyFraction: provider.weeklyFraction,
      slotWidth,
    })
    const groupX = i * (slotWidth + gap)
    groups.push(`<g transform="translate(${groupX}, 0)">${extractSvgInnerContent(providerSvg)}</g>`)
  }

  return `<svg width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" xmlns="http://www.w3.org/2000/svg">${groups.join("")}</svg>`
}

export async function renderMultiTrayIcon(args: {
  providers: MultiTrayProviderIcon[]
  sizePx: number
  compact?: boolean
  displayMode?: "percent" | "bars"
}): Promise<Image> {
  const { providers, sizePx, compact = true, displayMode = "percent" } = args
  const layout = getMultiTraySvgLayout({ providers, sizePx, compact, displayMode })
  const svg = makeMultiTrayBarsSvg({ providers, sizePx, compact, displayMode })
  const rgba = await rasterizeSvgToRgba(svg, layout.width, layout.height)
  return await Image.new(rgba, layout.width, layout.height)
}

export async function renderTrayBarsIcon(args: {
  bars: TrayPrimaryBar[]
  sizePx: number
  style?: MenubarIconStyle
  percentText?: string
  secondaryPercentText?: string
  providerIconUrl?: string
  providerId?: string
  compact?: boolean
}): Promise<Image> {
  const {
    bars,
    sizePx,
    style = "provider",
    percentText,
    secondaryPercentText,
    providerIconUrl,
    providerId,
    compact = false,
  } = args
  const top = normalizePercentText(percentText)
  const bottom = normalizePercentText(secondaryPercentText)
  const svg = makeTrayBarsSvg({
    bars,
    sizePx,
    style,
    percentText: top,
    secondaryPercentText: bottom,
    providerIconUrl,
    providerId,
    compact,
  })
  const layout = getSvgLayout({
    sizePx,
    style,
    percentText: top,
    secondaryPercentText: bottom,
    compact,
  })
  const rgba = await rasterizeSvgToRgba(svg, layout.width, layout.height)
  return await Image.new(rgba, layout.width, layout.height)
}

export function getTrayIconSizePx(devicePixelRatio: number | undefined): number {
  const dpr = typeof devicePixelRatio === "number" && devicePixelRatio > 0 ? devicePixelRatio : 1
  // 18pt-ish slot -> render at 18px * dpr for crispness (36px on Retina).
  return Math.max(18, Math.round(18 * dpr))
}
