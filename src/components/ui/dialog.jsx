"use client"

import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useLanguage } from '@/lib/LanguageContext';
import { useBackClosableRoot } from '@/hooks/useBackClosableRoot';

// Closes on the phone's Back gesture. See useBackClosableRoot.
function Dialog({ open, defaultOpen, onOpenChange, ...props }) {
  const root = useBackClosableRoot({ open, defaultOpen, onOpenChange });
  return <DialogPrimitive.Root {...props} open={root.open} onOpenChange={root.onOpenChange} />
}

const DialogTrigger = DialogPrimitive.Trigger

const DialogPortal = DialogPrimitive.Portal

const DialogClose = DialogPrimitive.Close

const DialogOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/80",
      "data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
      "duration-200",
      className
    )}
    {...props} />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

// `closeClassName` styles the built-in X for ONE dialog without touching
// every other dialog in the app. Dialogs with a coloured header (the
// league tiers, for one) need a different X colour than the default
// foreground-on-background, and the focus halo reads as a circle drawn
// around the icon once a touch has focused it.
// Block body rather than an implicit return: the sr-only close label below is
// a real string a screen-reader user hears, so it needs tFallback, and a hook
// cannot live in an expression-bodied arrow.
const DialogContent = React.forwardRef(({ className, overlayClassName, children, title, closeClassName, ...props }, ref) => {
  const { tFallback } = useLanguage();
  return (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-[calc(100%-2rem)] max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg rounded-2xl",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
        "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
        "data-[state=open]:slide-in-from-start-1/2 data-[state=open]:slide-in-from-top-[48%]",
        "data-[state=closed]:slide-out-to-start-1/2 data-[state=closed]:slide-out-to-top-[48%]",
        "duration-200",
        className
      )}
      {...props}>
      {/* Radix requires every DialogContent to have a Title for its
          accessible name, or it logs a dev warning and screen readers
          announce an unlabeled dialog. Dialogs whose heading isn't a
          <DialogTitle> (custom-styled headers, or step wizards) pass a
          `title` string and we render it sr-only — no visual change.
          Dialogs that already include their own <DialogTitle> just omit
          the prop, so there's never a duplicate. */}
      {title ? (
        <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>
      ) : null}
      {children}
      <DialogPrimitive.Close
        className={cn(
          "absolute end-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground",
          closeClassName
        )}>
        <X className="h-4 w-4" />
        <span className="sr-only">{tFallback("common.close", "Close")}</span>
      </DialogPrimitive.Close>
    </DialogPrimitive.Content>
  </DialogPortal>
  );
})
DialogContent.displayName = DialogPrimitive.Content.displayName

const DialogHeader = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col space-y-1.5 text-center sm:text-start", className)}
    {...props} />
)
DialogHeader.displayName = "DialogHeader"

const DialogFooter = ({
  className,
  ...props
}) => (
  <div
    className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2", className)}
    {...props} />
)
DialogFooter.displayName = "DialogFooter"

const DialogTitle = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold leading-none tracking-tight", className)}
    {...props} />
))
DialogTitle.displayName = DialogPrimitive.Title.displayName

const DialogDescription = React.forwardRef(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
))
DialogDescription.displayName = DialogPrimitive.Description.displayName

export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
}