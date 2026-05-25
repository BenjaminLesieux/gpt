import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border px-1.5 py-0 font-mono text-[11px] font-medium whitespace-nowrap transition-colors duration-100 focus-visible:ring-2 focus-visible:ring-ring [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        // Neutral — surface-raised bg, muted text
        default:
          "border-border bg-secondary text-muted-foreground",
        // Subdued surface, even more muted
        secondary:
          "border-border bg-secondary text-muted-foreground",
        // Soft danger — translucent red bg + accent text
        destructive:
          "border-brand-border/30 bg-brand-dim text-brand-bright",
        // Outline only
        outline:
          "border-border text-foreground",
        // Added (diff) — cold green
        ghost:
          "border-transparent bg-transparent text-muted-foreground",
        link: "border-transparent text-brand-bright underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
