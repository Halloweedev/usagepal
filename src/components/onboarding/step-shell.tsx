import type { ReactNode } from "react"

type StepShellProps = {
  title: string
  description?: string
  children?: ReactNode
  /** Right-aligned footer actions (Back + the primary button). */
  actions: ReactNode
  /** Left-aligned footer action (the skip/secondary affordance). */
  secondaryAction?: ReactNode
}

/** Shared step layout: sentence-case title, optional one-line explanation,
 * scrollable body, and a full-width footer row (secondary action left,
 * primary actions right). Title and body share one centered column so text
 * aligns with the step's miniatures; sections stagger in via animation delays. */
export function StepShell({ title, description, children, actions, secondaryAction }: StepShellProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="mx-auto w-full max-w-sm shrink-0 space-y-1.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto py-5 animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "120ms", animationFillMode: "both" }}
      >
        <div className="mx-auto w-full max-w-sm">{children}</div>
      </div>
      <div
        className="shrink-0 border-t pt-4 animate-in fade-in duration-300"
        style={{ animationDelay: "240ms", animationFillMode: "both" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">{secondaryAction}</div>
          <div className="flex items-center gap-3">{actions}</div>
        </div>
      </div>
    </div>
  )
}
