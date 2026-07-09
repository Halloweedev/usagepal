import type { ReactNode } from "react"

/** Test stand-in for `@/components/ui/tooltip`: renders triggers and content
 * inline (no portal/positioning), honoring the render-prop contract of
 * TooltipTrigger. Use as `vi.mock("@/components/ui/tooltip", () => import("@/test/tooltip-mock"))`. */
export const Tooltip = ({ children }: { children: ReactNode }) => <div>{children}</div>

export const TooltipTrigger = ({
  children,
  render: renderProp,
  ...props
}: {
  children?: ReactNode
  render?: ((props: Record<string, unknown>) => ReactNode) | ReactNode
}) => {
  if (typeof renderProp === "function") return renderProp({ ...props, children })
  if (renderProp) return renderProp
  return <div {...props}>{children}</div>
}

export const TooltipContent = ({ children }: { children: ReactNode }) => <div>{children}</div>
