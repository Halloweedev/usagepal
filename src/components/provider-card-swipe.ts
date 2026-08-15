import { useEffect, useRef, useState } from "react"
import type {
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from "react"

/** Slide/spring duration (ms). The setTimeout that swaps content is matched to
 * the CSS transition below. */
export const SWIPE_DURATION_MS = 220
/** Movement under this (px) is a tap, not a drag — buttons still click. */
export const TAP_SLOP = 6
/** A flick this fast (px/ms) commits even below the distance threshold, so a
 * quick short swipe still pages. */
export const FLICK_VELOCITY = 0.35
/** Drag past the end damps to this fraction, giving a soft rubber-band feel. */
const EDGE_RESISTANCE = 0.35

/** Given a horizontal drag delta (px; negative = leftward), decide the new
 * account index. Swipe left → next, right → previous, clamped to [0, count-1].
 * Deltas under `threshold` (or count ≤ 1) keep the current index. */
export function resolveSwipeTarget(
  deltaX: number,
  threshold: number,
  index: number,
  count: number
): number {
  if (count <= 1) return index
  if (deltaX <= -threshold && index < count - 1) return index + 1
  if (deltaX >= threshold && index > 0) return index - 1
  return index
}

/** Decide the target index from a completed gesture, folding in flick velocity:
 * a fast flick lowers the effective distance to `TAP_SLOP` so short quick swipes
 * still page, while sub-slop jitter is ignored so a tap never pages. */
export function resolveSwipeCommit(
  deltaX: number,
  velocityX: number,
  index: number,
  count: number,
  threshold: number,
  slop: number = TAP_SLOP
): number {
  if (Math.abs(deltaX) < slop) return index
  const effective = Math.abs(velocityX) >= FLICK_VELOCITY ? slop : threshold
  return resolveSwipeTarget(deltaX, effective, index, count)
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  )
}

/**
 * Drag-follow swipe for the account card. The whole card is the drag surface:
 * content tracks the finger live, then springs back or slides to the adjacent
 * account on release. Uses pointer capture so a drag started anywhere on the
 * card keeps tracking even over buttons, and a movement threshold so a real
 * tap still activates the control under it (`onClickCapture` swallows the click
 * that follows an actual drag).
 *
 * `contentStyle` is applied to the moving content wrapper; the drag surface it
 * sits in should be `overflow-hidden` so the outgoing card is clipped, not
 * overlapping its neighbours during the slide.
 */
export function useHorizontalSwipe({
  index,
  count,
  onChange,
  threshold = 40,
}: {
  index: number
  count: number
  onChange: (next: number) => void
  threshold?: number
}): {
  handlers: {
    onPointerDown: (e: ReactPointerEvent) => void
    onPointerMove: (e: ReactPointerEvent) => void
    onPointerUp: (e: ReactPointerEvent) => void
    onPointerCancel: (e: ReactPointerEvent) => void
    onClickCapture: (e: ReactMouseEvent) => void
  }
  contentStyle: CSSProperties
} {
  const [offset, setOffset] = useState(0)
  const [transition, setTransition] = useState(false)

  const startX = useRef<number | null>(null)
  const startTime = useRef(0)
  const widthRef = useRef(0)
  const movedRef = useRef(false)
  const animatingRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      if (timerRef.current != null) clearTimeout(timerRef.current)
    }
  }, [])

  const onPointerDown = (e: ReactPointerEvent) => {
    if (count <= 1 || animatingRef.current) return
    startX.current = e.clientX
    startTime.current = e.timeStamp
    widthRef.current = (e.currentTarget as HTMLElement).offsetWidth || 0
    movedRef.current = false
    setTransition(false)
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
    } catch {
      // setPointerCapture can throw if the pointer is already gone; ignore.
    }
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    if (startX.current == null) return
    let delta = e.clientX - startX.current
    if (Math.abs(delta) > TAP_SLOP) movedRef.current = true
    // Soft resistance when dragging past the first/last account.
    if ((delta > 0 && index === 0) || (delta < 0 && index === count - 1)) {
      delta *= EDGE_RESISTANCE
    }
    setOffset(delta)
  }

  const finish = (e: ReactPointerEvent) => {
    if (startX.current == null) return
    const delta = e.clientX - startX.current
    const dt = Math.max(1, e.timeStamp - startTime.current)
    const velocity = delta / dt
    startX.current = null
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId)
    } catch {
      // ignore
    }

    const target = resolveSwipeCommit(delta, velocity, index, count, threshold)
    if (target === index) {
      // Not far/fast enough — spring back to centre.
      setTransition(true)
      setOffset(0)
      return
    }

    const dir = delta < 0 ? -1 : 1
    const width = widthRef.current || Math.abs(delta) * 2

    if (prefersReducedMotion()) {
      onChange(target)
      setTransition(false)
      setOffset(0)
      return
    }

    // Slide the current card off in the drag direction, swap content, then slide
    // the new card in from the opposite edge.
    animatingRef.current = true
    setTransition(true)
    setOffset(dir * width)
    timerRef.current = window.setTimeout(() => {
      onChange(target)
      setTransition(false)
      setOffset(-dir * width)
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = requestAnimationFrame(() => {
          setTransition(true)
          setOffset(0)
          timerRef.current = window.setTimeout(() => {
            animatingRef.current = false
          }, SWIPE_DURATION_MS)
        })
      })
    }, SWIPE_DURATION_MS)
  }

  const onClickCapture = (e: ReactMouseEvent) => {
    // A gesture that actually moved shouldn't also click the control it ended on.
    if (movedRef.current) {
      e.preventDefault()
      e.stopPropagation()
      movedRef.current = false
    }
  }

  return {
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
      onClickCapture,
    },
    contentStyle: {
      transform: `translateX(${offset}px)`,
      transition: transition
        ? `transform ${SWIPE_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`
        : "none",
      willChange: "transform",
    },
  }
}
