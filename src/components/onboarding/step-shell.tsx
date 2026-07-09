import type { ReactNode } from "react"

type StepShellProps = {
  title: string
  description?: string
  children?: ReactNode
  actions: ReactNode
}

/** Shared step layout: sentence-case title, optional one-line explanation,
 * scrollable body, bottom action row. Sections stagger in via animation delays. */
export function StepShell({ title, description, children, actions }: StepShellProps) {
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="shrink-0 space-y-1.5 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">{title}</h1>
        {description && <p className="text-sm leading-6 text-muted-foreground">{description}</p>}
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto py-5 pr-1 animate-in fade-in slide-in-from-bottom-2 duration-300"
        style={{ animationDelay: "120ms", animationFillMode: "both" }}
      >
        {children}
      </div>
      <div
        className="shrink-0 border-t pt-4 animate-in fade-in duration-300"
        style={{ animationDelay: "240ms", animationFillMode: "both" }}
      >
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      </div>
    </div>
  )
}
