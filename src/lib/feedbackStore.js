// src/lib/feedbackStore.js
//
// The state behind the feedback pill (components/feedback/FeedbackPill.jsx),
// which replaced sonner's toast box on 2026-09-27. Kegan: "These toasts need
// to go, I hate them. I want them replaced with custom animated ones that
// feel more engaging, like in other apps."
//
// Plain module state with no React and no imports, so `@/lib/toast` (and
// every data module that calls it) stays importable in tests that stub the
// world. The pill subscribes with useSyncExternalStore.
//
// ONE message is on screen at a time, the way an iPhone's Dynamic Island or
// a Duolingo banner behaves. A stack of boxes was the thing being replaced.
// A new message replaces the current one in place (the pill morphs to it),
// with one exception: an error keeps the screen for ERROR_HOLD_MS before a
// non-error may replace it. A save that failed and then a cheerful "quest
// progress" arriving 200ms later must not wipe the failure before anyone
// can read it. Those later messages queue instead and play in order.
//
// Timers live here rather than in the component so behaviour is testable
// without rendering, and so a message shown while the pill is unmounted
// still expires instead of appearing stale when it mounts.

export const DEFAULT_DURATION_MS = {
  success: 2400,
  info: 3200,
  message: 3200,
  warning: 4000,
  error: 4500,
  default: 3200,
};
// A message carrying a button (Undo, Retry, Open) has to stay long enough to
// be pressed.
export const ACTION_MIN_MS = 5000;
export const ERROR_HOLD_MS = 1500;
export const MAX_QUEUE = 3;

let state = { current: null, queue: [] };
let seq = 0;
let timer = null;
const listeners = new Set();

const now = () => Date.now();

function emit() {
  for (const l of listeners) l();
}

function set(next) {
  state = next;
  emit();
}

function clearTimer() {
  if (timer) { clearTimeout(timer); timer = null; }
}

function durationFor(item) {
  const explicit = item.duration;
  if (explicit === Infinity) return Infinity;
  let ms = typeof explicit === 'number' && explicit > 0
    ? explicit
    : DEFAULT_DURATION_MS[item.kind] ?? DEFAULT_DURATION_MS.default;
  if (item.action) ms = Math.max(ms, ACTION_MIN_MS);
  return ms;
}

function schedule(item) {
  clearTimer();
  const ms = durationFor(item);
  if (ms === Infinity) return;
  timer = setTimeout(() => dismiss(item.id), ms);
}

function makeItem(kind, message, opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  seq += 1;
  return {
    id: o.id != null ? o.id : `fb-${seq}`,
    // `key` changes on every show, even for a reused id, so the pill replays
    // its icon animation when a message is updated in place.
    key: seq,
    kind,
    message,
    description: o.description ?? null,
    action: o.action && typeof o.action === 'object' && o.action.label ? o.action : null,
    icon: o.icon ?? null,
    duration: o.duration,
    onDismiss: typeof o.onDismiss === 'function' ? o.onDismiss : null,
    shownAt: now(),
  };
}

function present(item) {
  set({ current: { ...item, shownAt: now() }, queue: state.queue });
  schedule(item);
}

/** Show a message. Returns its id, like sonner did, so callers can dismiss it. */
export function show(kind, message, opts) {
  const item = makeItem(kind, message, opts);
  const cur = state.current;

  // Same id: update in place and restart the clock (sonner semantics, used by
  // the 329 call sites that pass `id` to stop repeats from stacking).
  if (cur && cur.id === item.id) {
    present(item);
    return item.id;
  }
  // Also drop any queued copy of this id; the newest wording wins.
  const queue = state.queue.filter((q) => q.id !== item.id);

  const heldError = cur && cur.kind === 'error' && item.kind !== 'error'
    && now() - cur.shownAt < ERROR_HOLD_MS;
  if (heldError) {
    const next = [...queue, item];
    while (next.length > MAX_QUEUE) next.shift();
    set({ current: cur, queue: next });
    return item.id;
  }

  state = { current: state.current, queue };
  present(item);
  return item.id;
}

/** Dismiss one message by id, or everything when no id is given. */
export function dismiss(id) {
  const cur = state.current;
  if (id == null) {
    clearTimer();
    set({ current: null, queue: [] });
    try { cur?.onDismiss?.(cur); } catch { /* caller's problem */ }
    return;
  }
  if (!cur || cur.id !== id) {
    const queue = state.queue.filter((q) => q.id !== id);
    if (queue.length !== state.queue.length) set({ current: cur, queue });
    return;
  }
  clearTimer();
  const [next, ...rest] = state.queue;
  set({ current: null, queue: rest });
  try { cur.onDismiss?.(cur); } catch { /* caller's problem */ }
  if (next) present(next);
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getSnapshot() {
  return state;
}

/** Test helper: back to empty with no timers pending. */
export function _reset() {
  clearTimer();
  seq = 0;
  state = { current: null, queue: [] };
  emit();
}
