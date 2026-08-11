// A controlled, in-app confirmation. Replaces `window.confirm`.
//
// `window.confirm` is a browser chrome dialog: it uses the OS font and
// buttons, ignores the app's theme entirely, cannot be translated (the
// Cancel/OK labels come from the browser locale, not ours), and on an
// installed PWA it reads as the app breaking out into the system rather than
// asking a question. It also blocks the main thread, so any animation
// mid-flight freezes behind it.
//
// Note the repo does NOT want this everywhere. Where an action is reversible,
// the established pattern is optimistic-action-plus-Undo-toast — see the
// comment at the top of GoalsList, which deliberately REMOVED its AlertDialog
// in favour of exactly that. Reach for this only where the action genuinely
// cannot be undone (deleting someone else's view of your content) or is
// relational and surprising to reverse (blocking a person).
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';

export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  destructive = false,
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={destructive
              ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
              : undefined}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
