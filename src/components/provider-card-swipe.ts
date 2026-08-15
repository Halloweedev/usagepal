import { useRef } from "react"
import type { PointerEvent as ReactPointerEvent } from "react"

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
}) {
  const startX = useRef<number | null>(null)

  const onPointerDown = (e: ReactPointerEvent) => {
    startX.current = e.clientX
  }
  const finish = (e: ReactPointerEvent) => {
    if (startX.current == null) return
    const delta = e.clientX - startX.current
    startX.current = null
    const next = resolveSwipeTarget(delta, threshold, index, count)
    if (next !== index) onChange(next)
  }
  return { onPointerDown, onPointerUp: finish, onPointerCancel: finish }
}
