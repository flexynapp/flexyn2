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
//
// Two engines, one vocabulary. In a browser this is `navigator.vibrate`,
// which Android honours and iOS Safari IGNORES, so an iPhone never felt any
// of it. Inside the Capacitor app it goes through @capacitor/haptics instead,
// which reaches the Taptic Engine on iOS and the vibrator on Android. The
// web path is unchanged. The plugin only exists in a native build made after
// it was installed; on an older build the call rejects and is swallowed.

import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from './native';

const LS_KEY = 'flexyn.hapticsDisabled';
const PATTERNS = {
  primary: [10],
  success: [18, 60, 18],
  warning: [28],
  subtle:  [6],
  // Tiny high-frequency "ready to go" tickle — fast rapid pulses.
  buzz:    [8, 8, 8, 8, 8],
};

// Native equivalents, chosen by meaning rather than by matching the ms
// pattern: iOS has a fixed set of system feels and a success is a
// notification, not two impacts.
const NATIVE = {
  primary: () => Haptics.impact({ style: ImpactStyle.Medium }),
  success: () => Haptics.notification({ type: NotificationType.Success }),
  warning: () => Haptics.notification({ type: NotificationType.Warning }),
  subtle: () => Haptics.impact({ style: ImpactStyle.Light }),
  buzz: () => Haptics.impact({ style: ImpactStyle.Light }),
};

// Short names for the same hierarchy, so a call site reads as intent:
// `haptic('light')` on a tap that commits something small, `haptic('medium')`
// on the one primary action of a screen. They map onto the patterns above
// rather than adding new ones, so there is still exactly one vocabulary.
// triggerHaptic resolves them too: ten call sites passed 'light' to it and
// got the heavier primary tick, because only haptic() knew the alias.
const ALIASES = {
  light: 'subtle',
  medium: 'primary',
  heavy: 'warning',
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
 * vibrate (iOS Safari, desktops, etc) outside the native app.
 *
 * @param {'primary'|'success'|'warning'|'subtle'|'buzz'|'light'|'medium'|'heavy'} intensity
 */
export function triggerHaptic(intensity = 'primary') {
  const name = PATTERNS[intensity] ? intensity : (ALIASES[intensity] || 'primary');
  const native = isNative();
  if (!native && (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function')) return;
  if (isDisabled()) return;
  if (prefersReducedMotion() && name !== 'warning') return; // warnings still fire for safety
  const now = Date.now();
  if (now - lastFiredAt < MIN_GAP_MS) return;
  lastFiredAt = now;
  if (native) {
    try { Promise.resolve(NATIVE[name]()).catch(() => {}); } catch { /* ignore */ }
    return;
  }
  try { navigator.vibrate(PATTERNS[name]); } catch { /* ignore */ }
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

/**
 * Same as triggerHaptic, defaulting to 'light'. Same settings, reduced
 * motion and rate limit rules apply.
 *
 * @param {'light'|'medium'|'heavy'|'primary'|'success'|'warning'|'subtle'} [intensity]
 */
export function haptic(intensity = 'light') {
  triggerHaptic(intensity);
}
