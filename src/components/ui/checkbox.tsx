import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "@/lib/utils"
import { Check as CheckIcon } from "@phosphor-icons/react"

function Checkbox({ className, ...props }: CheckboxPrimitive.Root.Props) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "group/checkbox peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px] border shadow-xs outline-none transition-[color,background-color,border-color,box-shadow]",
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
        "data-unchecked:border-border data-unchecked:bg-muted data-unchecked:text-foreground",
        "data-focused:data-unchecked:border-border data-focused:data-unchecked:bg-muted",
        "aria-invalid:aria-checked:border-primary aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 focus-visible:border-ring focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 group-has-disabled/field:opacity-50 focus-visible:ring-3 aria-invalid:ring-3 after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        keepMounted={false}
        className="grid place-content-center text-current group-data-unchecked/checkbox:hidden data-ending-style:hidden [&>svg]:size-3.5"
      >
        <CheckIcon
        />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
