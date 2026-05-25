// src/lib/haptic.js
//
// Centralized haptic feedback. The goal is a TACTILE HIERARCHY: every
// primary action vibrates briefly; secondary / informational actions
// stay silent. Over time users learn which buttons "matter" through
// their thumbs. This is one of the quietest quality signals an app
// can ship — users can't articulate why a well-haptic'd app feels
// better, but they feel it instantly when it's missing.
//
// Inspired by Apple's pattern across iOS — system primary actions buzz,
// secondary don't. Without consistency the cue becomes noise; with
// consistency it becomes language.
//
// Patterns (intensity → vibration shape in ms):
//   primary    — single short tick. Generic "you did a thing."
//   success    — double-tap.        After a confirm/save completes.
//   warning    — single longer pulse. Destructive confirm.
//   subtle     — very short. For high-frequency micro-interactions
//                (e.g. dragging a slider past a notch).
//
// Settings respect: if `flexyn.hapticsDisabled` is set in localStorage
// the call is a no-op (we expose a toggle in Settings). Reduced-motion
// users typically also want low haptics so we honor that signal too.
//
// Rate limiting: at most one haptic per 80ms — prevents accidental
// haptic spam from rapid taps or buggy loops.

const LS_KEY = 'flexyn.hapticsDisabled';
const PATTERNS = {
  primary: [10],
  success: [18, 60, 18],
  warning: [28],
  subtle:  [6],
  // Tiny high-frequency "ready to go" tickle — fast rapid pulses.
  buzz:    [8, 8, 8, 8, 8],
};

let lastFiredAt = 0;
const MIN_GAP_MS = 80;

function isDisabled() {
  try { return localStorage.getItem(LS_KEY) === '1'; } catch { return false; }
}

function prefersReducedMotion() {
  if (typeof window === 'undefined') return false;
  try {
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch { return false; }
}

/**
 * Fire a haptic pulse. Intensity defaults to 'primary'. Safe to call
 * from anywhere — gracefully no-ops on platforms without navigator.
 * vibrate (iOS Safari pre-16.4, desktops, etc).
 *
 * @param {'primary'|'success'|'warning'|'subtle'} intensity
 */
export function triggerHaptic(intensity = 'primary') {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
  if (isDisabled()) return;
  if (prefersReducedMotion() && intensity !== 'warning') return; // warnings still fire for safety
  const now = Date.now();
  if (now - lastFiredAt < MIN_GAP_MS) return;
  lastFiredAt = now;
  const pattern = PATTERNS[intensity] || PATTERNS.primary;
  try { navigator.vibrate(pattern); } catch { /* ignore */ }
}

/**
 * Settings toggle setter — wired from SettingsPanel. Passing `true`
 * disables all haptics for this device until re-enabled. Stored in
 * localStorage (per-device, intentionally — a user who silenced their
 * phone wants the choice to persist there only).
 */
export function setHapticsDisabled(disabled) {
  try {
    if (disabled) localStorage.setItem(LS_KEY, '1');
    else localStorage.removeItem(LS_KEY);
  } catch { /* best-effort */ }
}

export function getHapticsDisabled() {
  return isDisabled();
}
