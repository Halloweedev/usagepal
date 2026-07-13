import { Logo } from "@/components/logo"
import { cn } from "@/lib/utils"

export const WATERMARK_TEXT = "Track your AI usage with UsagePal"

/** Branded footer under a share card's surface. `subtextClassName` carries the
 * active card theme's muted text class so the watermark matches the theme. */
export function ShareWatermark({ subtextClassName }: { subtextClassName: string }) {
  return (
    <div
      data-testid="share-card-watermark"
      className={cn("flex items-center justify-center gap-1.5 pb-1 pt-2.5 text-xs", subtextClassName)}
    >
      <Logo aria-hidden="true" className="size-3.5 shrink-0" />
      {WATERMARK_TEXT}
    </div>
  )
}
