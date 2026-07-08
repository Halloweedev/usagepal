import { useEffect, useRef, type ReactNode, type RefObject } from "react"

// WebKit (Tauri's WKWebView) sometimes leaves a stale paint on elements that sat behind or inside a
// `backdrop-blur` compositing layer once it mounts/unmounts — a button's border/background can render
// as invisible until something else forces a repaint. A synchronous reflow clears it without any
// visible flicker.
function forceRepaint() {
  const { body } = document
  const previousDisplay = body.style.display
  body.style.display = "none"
  void body.offsetHeight
  body.style.display = previousDisplay
}

export function FocusTrapDialog({
  label,
  onClose,
  initialFocusRef,
  focusableSelector = '[role="radio"], [role="checkbox"]',
  children,
}: {
  label: string
  onClose: () => void
  initialFocusRef?: RefObject<HTMLElement | null>
  focusableSelector?: string
  children: ReactNode
}) {
  const dialogRef = useRef<HTMLDivElement>(null)

  const focusableControls = () =>
    Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? [])

  // Run once on mount only. Re-running this on every dependency-identity change would
  // steal focus back to the first control whenever the parent re-renders — e.g. a
  // consumer passing an inline `onClose` arrow gets a new identity on every re-render,
  // which would otherwise snap focus back to the first control mid-interaction.
  useEffect(() => {
    (initialFocusRef?.current ?? focusableControls()[0])?.focus()
    forceRepaint()
    return forceRepaint
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }

      if (event.key !== "Tab") return

      const controls = focusableControls()
      const firstControl = controls[0]
      const lastControl = controls[controls.length - 1]

      if (event.shiftKey && document.activeElement === firstControl) {
        event.preventDefault()
        lastControl?.focus()
      } else if (!event.shiftKey && document.activeElement === lastControl) {
        event.preventDefault()
        firstControl?.focus()
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose, focusableSelector])

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={label}
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="bg-card rounded-lg border shadow-xl p-4 max-w-xs w-full mx-4 animate-in fade-in zoom-in-95 duration-200">
        {children}
      </div>
    </div>
  )
}
