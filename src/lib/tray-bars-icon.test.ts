import { describe, expect, it, vi } from "vitest"

vi.mock("@tauri-apps/api/image", () => ({
  Image: {
    new: vi.fn(async () => ({})),
  },
}))

import {
  getBarFillLayout,
  getBarsStyleTrackLayout,
  getMultiTrayProviderGap,
  getMultiTraySvgLayout,
  getTrayIconSizePx,
  makeMultiTrayBarsSvg,
  makeTrayBarsSvg,
  renderMultiTrayIcon,
  renderTrayBarsIcon,
} from "@/lib/tray-bars-icon"

describe("tray-bars-icon", () => {
  it("getTrayIconSizePx renders 18px at 1x and 36px at 2x", () => {
    expect(getTrayIconSizePx(1)).toBe(18)
    expect(getTrayIconSizePx(2)).toBe(36)
  })

  it("default style is provider", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
    })
    expect(svg).toContain("<circle ")
    expect(svg).not.toContain("<rect ")
  })

  it("style=provider renders image and no bars", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "provider",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })
    expect(svg).toContain("<image ")
    expect(svg).not.toContain("<rect ")
    expect(svg).not.toContain("<path ")
  })

  it("style=bars renders bar SVG elements and no image", () => {
    const svg = makeTrayBarsSvg({
      bars: [{ id: "a", fraction: 0.5 }],
      sizePx: 36,
      style: "bars",
    })
    expect(svg).toContain("<rect ")
    expect(svg).toContain("<path ")
    expect(svg).not.toContain("<image ")
  })

  it("style=bars with empty bars renders a single empty track", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "bars",
    })
    expect(svg).toContain("<rect ")
    expect(svg).not.toContain("<path ")
    expect(svg).not.toContain("<image ")
  })

  it("style=bars with near-full fraction (0.95) renders bars (rect and path)", () => {
    const svg = makeTrayBarsSvg({
      bars: [{ id: "a", fraction: 0.95 }],
      sizePx: 36,
      style: "bars",
    })
    expect(svg).toContain("<rect ")
    expect(svg).toContain("<path ")
    expect(svg).not.toContain("<image ")
  })

  it("style=donut renders ring arc and centered provider icon", () => {
    const svg = makeTrayBarsSvg({
      bars: [{ id: "a", fraction: 0.42 }],
      sizePx: 36,
      style: "donut",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })
    expect(svg).toContain('stroke-dasharray="')
    expect(svg).toContain("<image ")
    expect(svg).not.toContain("<rect ")
  })

  it("style=donut falls back to center glyph when provider icon is missing", () => {
    const svg = makeTrayBarsSvg({
      bars: [{ id: "a", fraction: 0.42 }],
      sizePx: 36,
      style: "donut",
    })
    expect(svg).toContain("<circle ")
    expect(svg).not.toContain("<image ")
    expect(svg).not.toContain("<rect ")
  })

  it("renders provider icon", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })

    expect(svg).toContain("<image ")
    expect(svg).toContain('href="data:image/svg+xml;base64,ABC"')
    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
    expect(viewBox).toBeTruthy()
    if (viewBox) {
      const width = Number(viewBox[1])
      const height = Number(viewBox[2])
      expect(width).toBe(height)
    }
  })

  it("falls back to circle glyph when provider icon is missing", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
    })
    expect(svg).not.toContain("<image ")
    expect(svg).toContain("<circle ")
  })

  it("never renders svg text", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 18,
    })
    expect(svg).not.toContain("<text ")
  })

  it("renders svg text when percentage is provided", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 18,
      percentText: "70%",
    })
    expect(svg).toContain(">70%</text>")
  })

  it("provider renders two text lines when secondaryPercentText provided", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "provider",
      percentText: "100%",
      secondaryPercentText: "36%",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })
    expect(svg).toContain(">100%</text>")
    expect(svg).toContain(">36%</text>")
    expect(svg.match(/<text /g)?.length).toBe(2)
    const topY = svg.match(/y="(\d+)" fill="black"[^>]*>100%/)?.[1]
    const bottomY = svg.match(/y="(\d+)" fill="black"[^>]*>36%/)?.[1]
    expect(topY).toBeTruthy()
    expect(bottomY).toBeTruthy()
    if (topY && bottomY) {
      expect(Number(bottomY) - Number(topY)).toBeGreaterThanOrEqual(14)
    }
  })

  it("provider compact layout is narrower than default dual-line layout", () => {
    const defaultSvg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "provider",
      percentText: "100%",
      secondaryPercentText: "36%",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })
    const compactSvg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "provider",
      percentText: "100%",
      secondaryPercentText: "36%",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
      compact: true,
    })
    const defaultWidth = Number(defaultSvg.match(/viewBox="0 0 (\d+)/)?.[1])
    const compactWidth = Number(compactSvg.match(/viewBox="0 0 (\d+)/)?.[1])
    expect(compactWidth).toBeLessThan(defaultWidth)
  })

  it("provider icon renders larger than the old shrink baseline", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "provider",
      percentText: "70%",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })
    const iconSize = Number(svg.match(/<image[^>]*width="(\d+)"/)?.[1])
    expect(iconSize).toBeGreaterThanOrEqual(33)
  })

  it("scales OpenCode and Cline provider icons 10% smaller", () => {
    const defaultSvg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "provider",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })
    const scaledSvg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "provider",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
      providerId: "opencode-go",
    })
    const defaultSize = Number(defaultSvg.match(/<image[^>]*width="(\d+)"/)?.[1])
    const scaledSize = Number(scaledSvg.match(/<image[^>]*width="(\d+)"/)?.[1])
    expect(scaledSize).toBe(Math.round(defaultSize * 0.9))
  })

  it("provider renders only top line when secondary omitted", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "provider",
      percentText: "93%",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })
    expect(svg).toContain(">93%</text>")
    expect(svg.match(/<text /g)?.length).toBe(1)
  })

  it("compact provider with single percent uses dual-line primary font size", () => {
    const sizePx = 36
    const dualLineSvg = makeTrayBarsSvg({
      bars: [],
      sizePx,
      style: "provider",
      percentText: "100%",
      secondaryPercentText: "36%",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
      compact: true,
    })
    const singleLineSvg = makeTrayBarsSvg({
      bars: [],
      sizePx,
      style: "provider",
      percentText: "93%",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
      compact: true,
    })
    const dualFontSize = dualLineSvg.match(/font-size="(\d+)"[^>]*>100%/)?.[1]
    const singleFontSize = singleLineSvg.match(/font-size="(\d+)"[^>]*>93%/)?.[1]
    const largeFontSize = Math.max(9, Math.round(sizePx * 0.72))

    expect(dualFontSize).toBeTruthy()
    expect(singleFontSize).toBe(dualFontSize)
    expect(Number(singleFontSize)).not.toBe(largeFontSize)
    expect(singleLineSvg).not.toMatch(/font-size="${largeFontSize}"/)
  })

  it("compact provider bars mode renders mini bars instead of percent text", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "provider",
      percentText: "70%",
      secondaryPercentText: "36%",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
      compact: true,
      providerDisplayMode: "bars",
      sessionFraction: 0.7,
      weeklyFraction: 0.36,
    })
    expect(svg).toContain("<rect ")
    expect(svg).toContain("<path ")
    expect(svg).not.toContain("<text ")
    expect(svg).not.toContain(">70%</text>")
    expect(svg).not.toContain(">36%</text>")
  })

  it("compact provider bars mode uses bars-style track dimensions at 36px", () => {
    const sizePx = 36
    const barsLayout = getBarsStyleTrackLayout(sizePx)
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx,
      style: "provider",
      percentText: "70%",
      secondaryPercentText: "36%",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
      compact: true,
      providerDisplayMode: "bars",
      sessionFraction: 0.7,
      weeklyFraction: 0.36,
    })
    const trackRects = [
      ...svg.matchAll(/<rect x="(\d+)" y="(\d+)" width="(\d+)" height="(\d+)"/g),
    ]
    expect(trackRects.length).toBeGreaterThanOrEqual(2)
    const trackW = Number(trackRects[0]![3])
    const trackH = Number(trackRects[0]![4])
    expect(trackW).toBe(barsLayout.trackW)
    expect(trackH).toBe(barsLayout.trackH)

    const topY = Number(trackRects[0]![2])
    const bottomY = Number(trackRects[1]![2])
    expect(bottomY - (topY + trackH)).toBe(barsLayout.gap)
  })

  it("makeMultiTrayBarsSvg bars mode composes providers with mini bars", () => {
    const providers = [
      {
        iconUrl: "data:image/svg+xml;base64,ABC",
        sessionText: "70%",
        weeklyText: "36%",
        sessionFraction: 0.7,
        weeklyFraction: 0.36,
      },
      {
        iconUrl: "data:image/svg+xml;base64,DEF",
        sessionText: "42%",
        sessionFraction: 0.42,
      },
    ]
    const svg = makeMultiTrayBarsSvg({ providers, sizePx: 36, compact: true, displayMode: "bars" })
    expect(svg.match(/<rect /g)?.length).toBeGreaterThanOrEqual(4)
    expect(svg).not.toContain("<text ")
  })

  it("provider renders logo only when no percent text", () => {
    const svg = makeTrayBarsSvg({
      bars: [],
      sizePx: 36,
      style: "provider",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
    })
    expect(svg).not.toContain("<text ")
    expect(svg).toContain("<image ")
    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/)
    expect(viewBox?.[1]).toBe(viewBox?.[2])
  })

  it("getMultiTrayProviderGap uses 10% spacing with a 4px floor", () => {
    expect(getMultiTrayProviderGap(36)).toBe(4)
    expect(getMultiTrayProviderGap(18)).toBe(4)
    expect(getMultiTrayProviderGap(36)).toBe(Math.max(4, Math.round(36 * 0.1)))
  })

  it("makeMultiTrayBarsSvg composes providers horizontally with gaps", () => {
    const providers = [
      {
        iconUrl: "data:image/svg+xml;base64,ABC",
        sessionText: "70%",
        weeklyText: "36%",
      },
      {
        iconUrl: "data:image/svg+xml;base64,DEF",
        sessionText: "42%",
        weeklyText: "18%",
      },
      {
        iconUrl: "data:image/svg+xml;base64,GHI",
        sessionText: "55%",
      },
    ]
    const sizePx = 36
    const singleLayout = getMultiTraySvgLayout({
      providers: [providers[0]!],
      sizePx,
      compact: true,
    })
    const layout = getMultiTraySvgLayout({ providers, sizePx, compact: true })
    const svg = makeMultiTrayBarsSvg({ providers, sizePx, compact: true })
    const slotWidth = layout.providerWidths[0]!
    const gap = getMultiTrayProviderGap(sizePx)

    expect(layout.width).toBe(slotWidth * 3 + gap * 2)
    expect(singleLayout.width).toBe(slotWidth)
    expect(layout.slotCount).toBe(3)
    expect(svg.match(/<image /g)?.length).toBe(3)
    expect(svg).toContain(">70%</text>")
    expect(svg).toContain(">42%</text>")
    expect(svg).toContain(">55%</text>")
    expect(svg.match(/<g transform="translate\(/g)?.length).toBe(3)
  })

  it("multi tray layout width scales with provider count", () => {
    const sizePx = 36
    const baseProvider = {
      iconUrl: "data:image/svg+xml;base64,ABC",
      sessionText: "70%",
      weeklyText: "36%",
    }
    const one = getMultiTraySvgLayout({
      providers: [baseProvider],
      sizePx,
      compact: true,
    })
    const two = getMultiTraySvgLayout({
      providers: [baseProvider, { ...baseProvider, iconUrl: "data:image/svg+xml;base64,DEF" }],
      sizePx,
      compact: true,
    })
    const three = getMultiTraySvgLayout({
      providers: [
        baseProvider,
        { ...baseProvider, iconUrl: "data:image/svg+xml;base64,DEF" },
        { ...baseProvider, iconUrl: "data:image/svg+xml;base64,GHI" },
      ],
      sizePx,
      compact: true,
    })
    const slotWidth = one.providerWidths[0]!
    const gap = getMultiTrayProviderGap(sizePx)

    expect(one.slotCount).toBe(1)
    expect(two.slotCount).toBe(2)
    expect(three.slotCount).toBe(3)
    expect(one.width).toBe(slotWidth)
    expect(two.width).toBe(slotWidth * 2 + gap)
    expect(three.width).toBe(slotWidth * 3 + gap * 2)
    expect(one.width).toBeLessThan(two.width)
    expect(two.width).toBeLessThan(three.width)

    const four = getMultiTraySvgLayout({
      providers: [
        baseProvider,
        { ...baseProvider, iconUrl: "data:image/svg+xml;base64,DEF" },
        { ...baseProvider, iconUrl: "data:image/svg+xml;base64,GHI" },
        { ...baseProvider, iconUrl: "data:image/svg+xml;base64,JKL" },
      ],
      sizePx,
      compact: true,
    })

    expect(four.slotCount).toBe(4)
    expect(four.width).toBe(slotWidth * 4 + gap * 3)
    expect(three.width).toBeLessThan(four.width)
  })

  it("multi tray left-aligns providers without extra right padding", () => {
    const sizePx = 36
    const baseProvider = {
      iconUrl: "data:image/svg+xml;base64,ABC",
      sessionText: "70%",
      weeklyText: "36%",
    }
    const oneProviderLayout = getMultiTraySvgLayout({
      providers: [baseProvider],
      sizePx,
      compact: true,
    })
    const twoProviderLayout = getMultiTraySvgLayout({
      providers: [baseProvider, { ...baseProvider, iconUrl: "data:image/svg+xml;base64,DEF" }],
      sizePx,
      compact: true,
    })
    const threeProviderLayout = getMultiTraySvgLayout({
      providers: [
        baseProvider,
        { ...baseProvider, iconUrl: "data:image/svg+xml;base64,DEF" },
        { ...baseProvider, iconUrl: "data:image/svg+xml;base64,GHI" },
      ],
      sizePx,
      compact: true,
    })

    expect(oneProviderLayout.width).toBeLessThan(twoProviderLayout.width)
    expect(twoProviderLayout.width).toBeLessThan(threeProviderLayout.width)

    const oneProviderSvg = makeMultiTrayBarsSvg({
      providers: [baseProvider],
      sizePx,
      compact: true,
    })
    const twoProviderSvg = makeMultiTrayBarsSvg({
      providers: [baseProvider, { ...baseProvider, iconUrl: "data:image/svg+xml;base64,DEF" }],
      sizePx,
      compact: true,
    })
    const threeProviderSvg = makeMultiTrayBarsSvg({
      providers: [
        baseProvider,
        { ...baseProvider, iconUrl: "data:image/svg+xml;base64,DEF" },
        { ...baseProvider, iconUrl: "data:image/svg+xml;base64,GHI" },
      ],
      sizePx,
      compact: true,
    })

    const firstRenderedImageX = (svg: string) => {
      const groupX = Number(svg.match(/<g transform="translate\((\d+), 0\)">/)?.[1])
      const imageX = Number(svg.match(/<image[^>]*x="(\d+)"/)?.[1])
      return groupX + imageX
    }

    const pad = 3
    const slotWidth = oneProviderLayout.providerWidths[0]!
    const gap = getMultiTrayProviderGap(sizePx)

    expect(firstRenderedImageX(oneProviderSvg)).toBe(pad)
    expect(firstRenderedImageX(twoProviderSvg)).toBe(pad)
    expect(firstRenderedImageX(threeProviderSvg)).toBe(pad)

    const renderedImageXs = (svg: string) =>
      [...svg.matchAll(/<g transform="translate\((\d+), 0\)">[\s\S]*?<image[^>]*x="(\d+)"/g)].map(
        (match) => Number(match[1]) + Number(match[2]),
      )
    const twoProviderImageXs = renderedImageXs(twoProviderSvg)
    expect(twoProviderImageXs[1]! - twoProviderImageXs[0]!).toBe(slotWidth + gap)

    const oneProviderViewBoxWidth = Number(oneProviderSvg.match(/viewBox="0 0 (\d+)/)?.[1])
    expect(oneProviderViewBoxWidth).toBe(oneProviderLayout.width)
    expect(oneProviderViewBoxWidth).toBeLessThan(threeProviderLayout.width)
  })

  it("multi tray layout uses fixed gaps between provider slots", () => {
    const providers = [
      {
        iconUrl: "data:image/svg+xml;base64,ABC",
        sessionText: "70%",
        weeklyText: "36%",
      },
      {
        iconUrl: "data:image/svg+xml;base64,DEF",
        sessionText: "42%",
        weeklyText: "18%",
      },
    ]
    const sizePx = 36
    const layout = getMultiTraySvgLayout({ providers, sizePx, compact: true })
    const slotWidth = layout.providerWidths[0]!
    const expectedGap = getMultiTrayProviderGap(sizePx)
    expect(expectedGap).toBe(4)
    expect(layout.width).toBe(slotWidth * 2 + expectedGap)
    expect(layout.slotCount).toBe(2)
  })

  it("four-provider multi tray uses equal slot start spacing with mixed text lines", () => {
    const sizePx = 36
    const providers = [
      {
        iconUrl: "data:image/svg+xml;base64,ABC",
        sessionText: "70%",
        weeklyText: "36%",
      },
      {
        iconUrl: "data:image/svg+xml;base64,DEF",
        sessionText: "42%",
        weeklyText: "18%",
      },
      {
        iconUrl: "data:image/svg+xml;base64,GHI",
        sessionText: "55%",
      },
      {
        iconUrl: "data:image/svg+xml;base64,JKL",
        sessionText: "88%",
        weeklyText: "12%",
      },
    ]
    const layout = getMultiTraySvgLayout({ providers, sizePx, compact: true })
    const slotWidth = layout.providerWidths[0]!
    const gap = getMultiTrayProviderGap(sizePx)
    const svg = makeMultiTrayBarsSvg({ providers, sizePx, compact: true })

    const groupTranslates = [...svg.matchAll(/<g transform="translate\((\d+), 0\)">/g)].map((m) =>
      Number(m[1]),
    )
    expect(groupTranslates).toEqual([0, slotWidth + gap, (slotWidth + gap) * 2, (slotWidth + gap) * 3])

    const slotStarts = groupTranslates
    const distances = slotStarts.slice(1).map((start, i) => start - slotStarts[i]!)
    expect(new Set(distances)).toEqual(new Set([slotWidth + gap]))

    const singleLineSvg = makeTrayBarsSvg({
      bars: [],
      sizePx,
      style: "provider",
      percentText: "55%",
      providerIconUrl: "data:image/svg+xml;base64,GHI",
      compact: true,
    })
    const dualLineSvg = makeTrayBarsSvg({
      bars: [],
      sizePx,
      style: "provider",
      percentText: "100%",
      secondaryPercentText: "100%",
      providerIconUrl: "data:image/svg+xml;base64,ABC",
      compact: true,
    })
    const narrowWidth = Number(singleLineSvg.match(/viewBox="0 0 (\d+)/)?.[1])
    const fixedWidth = Number(dualLineSvg.match(/viewBox="0 0 (\d+)/)?.[1])
    expect(narrowWidth).toBeLessThan(fixedWidth)

    const forcedSvg = makeTrayBarsSvg({
      bars: [],
      sizePx,
      style: "provider",
      percentText: "55%",
      providerIconUrl: "data:image/svg+xml;base64,GHI",
      compact: true,
      slotWidth: fixedWidth,
    })
    expect(Number(forcedSvg.match(/viewBox="0 0 (\d+)/)?.[1])).toBe(fixedWidth)
  })

  it("multi tray layout width stays stable across text changes", () => {
    const sizePx = 36
    const providersLoading = [
      { iconUrl: "data:image/svg+xml;base64,ABC" },
      { iconUrl: "data:image/svg+xml;base64,DEF", sessionText: "9%" },
    ]
    const providersLoaded = [
      { iconUrl: "data:image/svg+xml;base64,ABC", sessionText: "100%", weeklyText: "100%" },
      { iconUrl: "data:image/svg+xml;base64,DEF", sessionText: "42%", weeklyText: "7%" },
    ]

    const loadingLayout = getMultiTraySvgLayout({
      providers: providersLoading,
      sizePx,
      compact: true,
    })
    const loadedLayout = getMultiTraySvgLayout({
      providers: providersLoaded,
      sizePx,
      compact: true,
    })
    const noTextToFullText = getMultiTraySvgLayout({
      providers: [{ iconUrl: "data:image/svg+xml;base64,ABC" }],
      sizePx,
      compact: true,
    })
    const withFullText = getMultiTraySvgLayout({
      providers: [
        { iconUrl: "data:image/svg+xml;base64,ABC", sessionText: "100%", weeklyText: "100%" },
      ],
      sizePx,
      compact: true,
    })

    expect(loadingLayout.providerWidths).toEqual(loadedLayout.providerWidths)
    expect(loadingLayout.width).toBe(loadedLayout.width)
    expect(noTextToFullText.width).toBe(withFullText.width)
  })

  it("renderMultiTrayIcon rasterizes composite SVG to an Image", async () => {
    const originalImage = window.Image
    const originalCreateElement = document.createElement.bind(document)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).Image = class MockImage {
      onload: null | (() => void) = null
      onerror: null | (() => void) = null
      decoding = "async"
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }

    const ctx = {
      clearRect: () => {},
      drawImage: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(document as any).createElement = (tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === "canvas") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(el as any).getContext = () => ctx
      }
      return el
    }

    try {
      const img = await renderMultiTrayIcon({
        providers: [
          {
            iconUrl: "data:image/svg+xml;base64,ABC",
            sessionText: "70%",
            weeklyText: "36%",
          },
          {
            iconUrl: "data:image/svg+xml;base64,DEF",
            sessionText: "42%",
          },
        ],
        sizePx: 18,
        compact: true,
      })
      expect(img).toBeTruthy()
    } finally {
      window.Image = originalImage
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(document as any).createElement = originalCreateElement
    }
  })

  it("renderTrayBarsIcon rasterizes SVG to an Image using canvas", async () => {
    const originalImage = window.Image
    const originalCreateElement = document.createElement.bind(document)

    // Stub Image loader to immediately fire onload once src is set.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).Image = class MockImage {
      onload: null | (() => void) = null
      onerror: null | (() => void) = null
      decoding = "async"
      set src(_value: string) {
        queueMicrotask(() => this.onload?.())
      }
    }

    // Stub canvas context
    const ctx = {
      clearRect: () => {},
      drawImage: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(w * h * 4),
      }),
    }

    // Patch createElement for canvas only
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(document as any).createElement = (tag: string) => {
      const el = originalCreateElement(tag)
      if (tag === "canvas") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(el as any).getContext = () => ctx
      }
      return el
    }

    try {
      const img = await renderTrayBarsIcon({
        bars: [],
        sizePx: 18,
      })
      expect(img).toBeTruthy()
    } finally {
      window.Image = originalImage
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(document as any).createElement = originalCreateElement
    }
  })
})

describe("getBarFillLayout", () => {
  // Retina track width: 36px icon - 2*3px pad = 30px.
  const TRACK = 30

  it("renders completely full at the 0.97 threshold (no tail)", () => {
    expect(getBarFillLayout(TRACK, 0.97)).toEqual({
      fillW: TRACK,
      remainderDrawW: 0,
      dividerX: null,
    })
  })

  it("renders completely full at 1.0", () => {
    expect(getBarFillLayout(TRACK, 1)).toEqual({
      fillW: TRACK,
      remainderDrawW: 0,
      dividerX: null,
    })
  })

  it("just below the threshold (0.96) leaves only a thin 2px tail", () => {
    // maxFillW = 30 - max(2, round(30*0.05)=2) = 28.
    expect(getBarFillLayout(TRACK, 0.96)).toEqual({
      fillW: 28,
      remainderDrawW: 2,
      dividerX: 28,
    })
  })

  it("renders the true fraction below the near-full band (0.90)", () => {
    expect(getBarFillLayout(TRACK, 0.9)).toEqual({
      fillW: 27,
      remainderDrawW: 3,
      dividerX: 27,
    })
  })

  it("no longer caps mid-high fills at 80% (0.85 fills past the old cap)", () => {
    // Old behavior capped fillW at 24 (80%); new floor lets it reach 26.
    expect(getBarFillLayout(TRACK, 0.85)).toEqual({
      fillW: 26,
      remainderDrawW: 4,
      dividerX: 26,
    })
  })

  it("returns an empty layout for zero/negative fraction", () => {
    expect(getBarFillLayout(TRACK, 0)).toEqual({
      fillW: 0,
      remainderDrawW: 0,
      dividerX: null,
    })
  })
})
