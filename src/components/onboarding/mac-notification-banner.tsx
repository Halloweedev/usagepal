import { Logo } from "@/components/logo"
import { MILESTONE_META, type PaceMilestone } from "@/lib/pace-notifications"

/** A miniature of the macOS notification banner UsagePal sends, used as a live
 * preview in onboarding. Remount with `key={milestone}` to replay the entrance.
 * The entrance is a slow, short crossfade so the 2s rotation reads as calm
 * flips rather than jittery re-slides. */
export function MacNotificationBanner({ milestone }: { milestone: PaceMilestone }) {
  const meta = MILESTONE_META[milestone]
  return (
    <div
      data-testid="notification-banner"
      className="mx-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border bg-card px-4 py-3 shadow-lg animate-in slide-in-from-top-1 fade-in duration-700 ease-out"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <Logo className="size-5" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate text-xs font-medium text-muted-foreground">UsagePal</p>
          <span className="shrink-0 text-[10px] text-muted-foreground">now</span>
        </div>
        <p className="truncate text-sm font-semibold text-foreground">{meta.title}</p>
        <p className="truncate text-xs text-muted-foreground">{meta.body}</p>
      </div>
    </div>
  )
}
