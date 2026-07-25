// src/lib/toast.js
//
// App-wide toast policy (kegan, Jul 2026): only ERROR toasts surface. Every
// other toast — success, info, reward/completion pop-ups, plain toast() — is
// suppressed until we ship the new subtle press/completion cues that don't
// obstruct the view. This is a drop-in replacement for the sonner import:
//   import { toast } from '@/lib/toast'
// Same shape as sonner's `toast`, but the non-error variants no-op. To bring
// a category back later, un-no-op it here — nothing at the call sites changes.
//
// NOTE: because plain `toast(...)` is silenced too, this also hides the
// Undo/action toasts (e.g. delete → Undo). If we want those back, allow-list
// calls whose second arg carries an `action`.
import { toast as sonnerToast } from 'sonner';

const noop = () => undefined;

// A toast that carries an `action` (Undo / Retry button) is a functional
// control, not a passive completion badge — keep those so we don't silently
// lose things like delete → Undo.
const hasAction = (opts) => !!(opts && typeof opts === 'object' && opts.action);

// Callable form: `toast('Saved!')` → suppressed, unless it has an action.
function toast(message, opts) {
  if (hasAction(opts)) return sonnerToast(message, opts);
  return undefined;
}

// Errors still reach the user so failures never go silent.
toast.error = (...args) => sonnerToast.error(...args);
// Keep dismiss working (harmless passthrough for any imperative toast.dismiss).
toast.dismiss = (...args) => sonnerToast.dismiss(...args);
// Promise helper: run the work, show nothing.
toast.promise = (p) => (typeof p === 'function' ? p() : p);

// Passive variants are silenced — but still honor a functional action button
// if one is attached (e.g. a "Retry" affordance on an info toast).
const keepIfAction = (fn) => (message, opts) => (hasAction(opts) ? fn(message, opts) : undefined);
toast.success = keepIfAction(sonnerToast.success);
toast.info = keepIfAction(sonnerToast.info);
toast.message = keepIfAction(sonnerToast.message);
toast.warning = keepIfAction(sonnerToast.warning);
toast.loading = noop;
toast.custom = noop;

export { toast };
export default toast;
