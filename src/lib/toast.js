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
// So `success` became a passthrough: it is the confirmation class, and an
// unconfirmed save is the worst failure mode here.
//
// ── 2026-08-05: info / message / warning follow, and here is why ──────────
//
// That first pass fixed one variant of four. A second audit scanned every
// remaining call site with a paren-balanced parser (so multi-line calls are
// read whole) and found **28 of 28** `info` / `message` / `warning` calls
// carry no `action`. Not most. All of them. The gate was not shaping this
// class of message, it was deleting the entire class.
//
// The argument for keeping them filtered was that they are "the chatty ones".
// The actual contents say otherwise:
//
//   SetRow.jsx              "Capped at 315 lb" / "Capped at 50 reps"
//   CardioLiveTracker…      "Auto-paused" / "Auto-resumed" / "GPS signal weak"
//   Onboarding.jsx          "Some profile details could not be saved"
//   DailyChestCard.jsx      "Already claimed today"
//
// The first is the app silently overwriting a number the user typed. The
// second means someone runs a 10k and finds half of it recorded. The third is
// a data-loss warning during signup. The fourth was added specifically to fix
// a bug a user reported — their complaint is quoted in that file — and it
// rendered nothing, so the fix was invisible and the report would have come
// back.
//
// `warning` in particular is error-adjacent. Muting "your data didn't save"
// was never a design decision anyone made; it was collateral from a policy
// aimed at completion badges.
//
// So all three are passthroughs now. `loading` and `custom` stay off — those
// really are decoration — and plain `toast()` stays action-gated.
//
// ── TO REVERT ────────────────────────────────────────────────────────────
//
// If the subtle inline cues ship and this class should go quiet again, wrap
// the variant back in keepIfAction on its line below. Nothing at the ~300
// call sites has to change either way; that is the whole point of this
// module. But before reverting any of them, re-run the audit — a variant
// where 100% of callers pass no action is not being filtered, it is being
// switched off, and `src/lib/__tests__/toastPolicy.test.js` now fails if a
// passthrough variant stops passing through.
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

// Retained for the plain `toast()` form above, and so re-filtering a variant
// is a one-word change rather than a rewrite. See "TO REVERT" in the header.
// eslint-disable-next-line no-unused-vars
const keepIfAction = (fn) => (message, opts) => (hasAction(opts) ? fn(message, opts) : undefined);

// Every variant below reaches the user. Each one is a thing the app needs to
// tell someone about an action they just took — a save that worked, a value
// that got clamped, a run that auto-paused, a field that failed to persist.
toast.success = (...args) => sonnerToast.success(...args);
toast.info    = (...args) => sonnerToast.info(...args);
toast.message = (...args) => sonnerToast.message(...args);
toast.warning = (...args) => sonnerToast.warning(...args);

// Decoration, not information. These stay off.
toast.loading = noop;
toast.custom = noop;

export { toast };
export default toast;
