import * as React from "react"

import { cn } from "@/lib/utils"
import { PICKER_TYPES, openNativePicker } from "@/lib/nativePicker"

const Input = React.forwardRef(({ className, type, onClick, ...props }, ref) => {
  // A date or time field opens its picker on a tap anywhere, not only on
  // the glyph. See src/lib/nativePicker.js.
  const handleClick = PICKER_TYPES.has(type)
    ? (e) => { onClick?.(e); if (!e.defaultPrevented) openNativePicker(e.currentTarget); }
    : onClick;
  return (
    (<input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      ref={ref}
      onClick={handleClick}
      {...props} />)
  );
})
Input.displayName = "Input"

export { Input }
