import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority";

import { cn } from "@/lib/utils"
import { haptic as fireHaptic } from "@/lib/haptic"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[color,background-color,border-color,box-shadow,transform] duration-150 active:scale-[0.98] motion-reduce:active:scale-100 motion-reduce:transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow hover:bg-primary/90 active:bg-primary/90",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 active:bg-destructive/90",
        outline:
          "border border-input bg-transparent shadow-sm hover:bg-accent active:bg-accent hover:text-accent-foreground active:text-accent-foreground",
        secondary:
          "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80 active:bg-secondary/80",
        ghost: "hover:bg-accent active:bg-accent hover:text-accent-foreground active:text-accent-foreground",
        link: "text-primary underline-offset-4 hover:underline active:scale-100",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

// Press feedback. Every button gives a 2% scale under the finger
// (active:scale-[0.98] above), which is the cheapest "the app felt that"
// signal there is and costs no colour, shadow or layout. Reduced motion
// keeps the colour change and drops the scale. Links do not shrink: an
// underlined word that moves reads as a glitch, not a press.
//
// `haptic` is opt in, because the tactile hierarchy in lib/haptic.js only
// works while most buttons stay silent. Pass haptic="light" (or "medium")
// on the ONE primary action of a screen.
const Button = React.forwardRef(({ className, variant, size, asChild = false, haptic, onClick, ...props }, ref) => {
  const Comp = asChild ? Slot : "button"
  const handleClick = haptic
    ? (e) => { fireHaptic(haptic === true ? 'light' : haptic); onClick?.(e) }
    : onClick
  return (
    (<Comp
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      onClick={handleClick}
      {...props} />)
  );
})
Button.displayName = "Button"

export { Button, buttonVariants }
