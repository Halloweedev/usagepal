import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  resolveSwipeCommit,
  resolveSwipeTarget,
  useHorizontalSwipe,
} from "@/components/provider-card-swipe"

function SwipeHarness({
  count,
  onButtonClick,
  onChange,
}: {
  count: number
  onButtonClick: () => void
  onChange: (next: number) => void
}) {
  const { handlers, contentStyle } = useHorizontalSwipe({ index: 0, count, onChange })
  return (
    <div data-testid="surface" {...handlers} style={contentStyle}>
      <button type="button" onClick={onButtonClick}>
        Tap me
      </button>
    </div>
  )
}

describe("resolveSwipeTarget", () => {
  const T = 40
  it("swiping left past threshold goes to next account", () => {
    expect(resolveSwipeTarget(-50, T, 0, 3)).toBe(1)
  })
  it("swiping right past threshold goes to previous account", () => {
    expect(resolveSwipeTarget(50, T, 1, 3)).toBe(0)
  })
  it("below threshold stays put", () => {
    expect(resolveSwipeTarget(-20, T, 1, 3)).toBe(1)
  })
  it("cannot page past the last account", () => {
    expect(resolveSwipeTarget(-100, T, 2, 3)).toBe(2)
  })
  it("cannot page before the first account", () => {
    expect(resolveSwipeTarget(100, T, 0, 3)).toBe(0)
  })
  it("single account never moves", () => {
    expect(resolveSwipeTarget(-999, T, 0, 1)).toBe(0)
  })
})

describe("resolveSwipeCommit", () => {
  const T = 40
  const slow = 0.05 // px/ms, below flick
  const flick = 0.5 // px/ms, a fast flick

  it("commits a slow drag only past the distance threshold", () => {
    expect(resolveSwipeCommit(-50, slow, 0, 3, T)).toBe(1)
    expect(resolveSwipeCommit(-20, slow, 0, 3, T)).toBe(0)
  })

  it("a fast flick pages even below the distance threshold", () => {
    expect(resolveSwipeCommit(-20, flick, 0, 3, T)).toBe(1)
    expect(resolveSwipeCommit(20, flick, 1, 3, T)).toBe(0)
  })

  it("sub-slop jitter never pages, however fast", () => {
    expect(resolveSwipeCommit(-4, flick, 0, 3, T)).toBe(0)
  })

  it("a flick still cannot page past the ends", () => {
    expect(resolveSwipeCommit(-30, flick, 2, 3, T)).toBe(2)
    expect(resolveSwipeCommit(30, flick, 0, 3, T)).toBe(0)
  })
})

describe("useHorizontalSwipe click forwarding", () => {
  beforeEach(() => {
    // jsdom lacks pointer capture; stub it so the hook's capture path is explicit.
    Object.defineProperty(Element.prototype, "setPointerCapture", {
      value: vi.fn(),
      configurable: true,
    })
    Object.defineProperty(Element.prototype, "releasePointerCapture", {
      value: vi.fn(),
      configurable: true,
    })
    // jsdom lacks elementFromPoint entirely; define it so tests can resolve the
    // real element under a point the way real browsers do.
    if (!document.elementFromPoint) {
      Object.defineProperty(document, "elementFromPoint", {
        value: vi.fn(() => null),
        configurable: true,
      })
    }
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("a tap on a child button fires the button's onClick even under pointer capture", () => {
    const onButtonClick = vi.fn()
    const onChange = vi.fn()
    render(<SwipeHarness count={2} onButtonClick={onButtonClick} onChange={onChange} />)
    const surface = screen.getByTestId("surface")
    const button = screen.getByRole("button", { name: "Tap me" })

    // Chromium retargets the click to the capturing surface; jsdom does not, so
    // simulate the real browser's delivery: elementFromPoint resolves the true
    // target, and the click event's target is the surface.
    const elementFromPoint = vi.mocked(document.elementFromPoint).mockReturnValue(button)

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(surface, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.click(surface, { clientX: 100, clientY: 50 })

    expect(elementFromPoint).toHaveBeenCalledWith(100, 50)
    expect(onButtonClick).toHaveBeenCalledTimes(1)
  })

  it("forwards a tap whose hit target is an SVG icon inside a button", () => {
    const onButtonClick = vi.fn()
    const onChange = vi.fn()
    render(<SwipeHarness count={2} onButtonClick={onButtonClick} onChange={onChange} />)
    const surface = screen.getByTestId("surface")
    const button = screen.getByRole("button", { name: "Tap me" })

    // The "+" button's hit target is its SVG glyph, not the button element.
    // SVG elements have no click() method, so forwarding must resolve the
    // nearest interactive ancestor instead of calling click() on the icon.
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg")
    button.appendChild(icon)
    const elementFromPoint = vi.mocked(document.elementFromPoint).mockReturnValue(icon)

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(surface, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.click(surface, { clientX: 100, clientY: 50 })

    expect(elementFromPoint).toHaveBeenCalledWith(100, 50)
    expect(onButtonClick).toHaveBeenCalledTimes(1)
  })

  it("a drag that ends on a button does not click it", () => {
    vi.useFakeTimers()
    const onButtonClick = vi.fn()
    const onChange = vi.fn()
    render(<SwipeHarness count={2} onButtonClick={onButtonClick} onChange={onChange} />)
    const surface = screen.getByTestId("surface")

    fireEvent.pointerDown(surface, { clientX: 100, clientY: 50, pointerId: 1 })
    fireEvent.pointerMove(surface, { clientX: 80, clientY: 50, pointerId: 1 })
    fireEvent.pointerUp(surface, { clientX: 80, clientY: 50, pointerId: 1 })
    fireEvent.click(surface, { clientX: 80, clientY: 50 })
    vi.runAllTimers()

    expect(onButtonClick).not.toHaveBeenCalled()
  })
})
