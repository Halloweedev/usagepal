import type { ReactNode } from "react"
import { Logo } from "@/components/logo"

type ChromelessWindowShellProps = {
  /** Optional right-aligned header content (e.g. onboarding step pips). */
  headerRight?: ReactNode
  children: ReactNode
}

/**
 * The outer chrome shared by the onboarding setup window and the what's-new
 * window: a rounded transparent container (the visible window shape), a
 * drag-region header with the logo, and a padded body area.
 */
export function ChromelessWindowShell({ headerRight, children }: ChromelessWindowShellProps) {
  return (
    <main className="flex h-screen flex-col overflow-hidden rounded-xl border bg-card text-foreground">
      <section className="flex h-full min-h-0 flex-col">
        <div
          data-tauri-drag-region
          className="flex shrink-0 items-center justify-between border-b px-6 py-4"
        >
          <div className="pointer-events-none flex items-center gap-3 text-lg font-semibold">
            <Logo className="size-9 text-foreground" aria-hidden />
            UsagePal
          </div>
          {headerRight && <div className="pointer-events-none">{headerRight}</div>}
        </div>
        <div className="min-h-0 flex-1 px-6 py-5 sm:px-8">{children}</div>
      </section>
    </main>
  )
}
