// src/lib/toast.js
//
// App-wide toast policy. This is a drop-in replacement for the sonner import:
//   import { toast } from '@/lib/toast'
// Same shape as sonner's `toast`; some variants are filtered here so nothing
// at the call sites has to change when the policy moves.
//
// History, because the current shape only makes sense with it. The July 2026
// policy (kegan) suppressed EVERY non-error toast — success, info, reward and
// completion pop-ups, plain toast() — pending "subtle press/completion cues"
// that don't obstruct the view.
//
// Those cues were never shipped, and an audit on 2026-08-04 measured the
// cost: of 283 toast.success/info/message/warning call sites, 271 (95%) carry
// no `action` and so rendered nothing at all. For a month, a successful save
// was pixel-identical to a dead button. CLAUDE.md already records this eating
// four rounds of work on the My Gym feature and files it as a one-off trap —
// it was not a trap, it was the default for most of the app. Logging a meal,
// the single healthiest signal in the product, confirmed nothing.
//
// So `success` is now a passthrough: it is the confirmation class, and an
// unconfirmed save is the worst failure mode here. `info` / `message` /
// `warning` stay filtered — those are the chatty ones the original policy was
// actually aimed at, and they still surface when they carry an `action`,
// because an action makes them a control rather than a passive badge.
// `loading` and `custom` stay off.
//
// If the subtle cues do ship, revert `success` to keepIfAction here and
// nothing at the call sites changes.
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
// Success is the confirmation class and always surfaces: a save the user
// cannot tell succeeded is indistinguishable from a broken button. See the
// header note before filtering this again.
toast.success = (...args) => sonnerToast.success(...args);
toast.info = keepIfAction(sonnerToast.info);
toast.message = keepIfAction(sonnerToast.message);
toast.warning = keepIfAction(sonnerToast.warning);
toast.loading = noop;
toast.custom = noop;

export { toast };
export default toast;
