// src/hooks/useFormDraft.js
//
// Auto-save form-state to localStorage on every change (debounced), so
// a user who navigates away mid-write doesn't lose their work. On
// remount, the hook surfaces the saved draft via a callback so the
// caller can repopulate fields, then shows a "Draft restored" toast
// with a "Discard" button.
//
// Pattern is universal across modern note + editor apps (Gmail compose,
// Notion, every Apple form). Without this, the fear of losing 10
// minutes of typing because of an accidental swipe back is a real
// retention killer.
//
// USAGE
//
//   const draft = useFormDraft({
//     key: `hubComposer.${user.email}`,
//     value: { body, kind, privacy },
//     onRestore: (saved) => {
//       setBody(saved.body ?? '');
//       setKind(saved.kind ?? 'status');
//       setPrivacy(saved.privacy ?? 'followers');
//     },
//     enabled: !!user?.email,
//   });
//
//   // On successful submit:
//   draft.clear();
//
// PROPERTIES
//
//   key       Unique per form + per user. Scoping by email prevents
//             multi-user devices from leaking drafts between accounts.
//   value     The current form state (any JSON-serializable shape).
//             The hook deep-clones on save to avoid persisting React
//             refs or unstable values.
//   onRestore Callback invoked once on mount if a usable draft exists.
//             Receives the parsed value. Caller decides whether/how to
//             repopulate fields.
//   enabled   When false, the hook is a no-op (avoids running before
//             the user identity is known).
//   debounceMs  Default 500ms. Storage write rate-limit.
//   staleMs   Default 7 days. Drafts older than this are auto-evicted
//             on mount.
//
//   Returns: { clear, hasRestored }
//
// SAFETY
//
//   • Writes are wrapped in try/catch — Safari private mode + quota
//     errors are common.
//   • The hook does NOT persist file blobs or non-serializable values.
//     Callers are expected to pass primitive shapes; image inputs etc
//     should be re-attached manually on restore (we don't try to
//     serialize Blobs into localStorage).
//   • Draft is cleared via the `clear()` callback — usually on
//     successful submit.

import { useEffect, useRef, useState, useCallback } from 'react';
import { toast } from 'sonner';

function safeRead(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.savedAt !== 'string') return null;
    return parsed;
  } catch { return null; }
}

function safeWrite(key, payload) {
  try {
    localStorage.setItem(key, JSON.stringify(payload));
  } catch { /* quota / private mode — best-effort */ }
}

function safeClear(key) {
  try {
    localStorage.removeItem(key);
  } catch { /* ignore */ }
}

const DEFAULT_STALE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_DEBOUNCE_MS = 500;

export function useFormDraft({
  key,
  value,
  onRestore,
  enabled = true,
  debounceMs = DEFAULT_DEBOUNCE_MS,
  staleMs = DEFAULT_STALE_MS,
  toastLabel = 'Draft restored',
} = {}) {
  // Track whether we've already attempted a restore on this mount so
  // we don't toast twice if the parent re-renders before the draft
  // value lands.
  const restoredRef = useRef(false);
  const [hasRestored, setHasRestored] = useState(false);

  // Snapshot the callbacks in refs so the effect deps stay primitive.
  // Otherwise a parent that re-creates onRestore each render would
  // re-trigger the restore branch on every render.
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;

  const clear = useCallback(() => {
    if (!key) return;
    safeClear(key);
  }, [key]);

  // RESTORE — runs once when enabled+key first become valid.
  useEffect(() => {
    if (!enabled || !key) return;
    if (restoredRef.current) return;
    restoredRef.current = true;

    const saved = safeRead(key);
    if (!saved) return;

    // Evict stale drafts silently — past N days they confuse more
    // than they help.
    const ageMs = Date.now() - new Date(saved.savedAt).getTime();
    if (Number.isFinite(ageMs) && ageMs > staleMs) {
      safeClear(key);
      return;
    }

    try {
      onRestoreRef.current?.(saved.value);
    } catch { /* caller error — don't swallow user data, but don't crash either */ }

    setHasRestored(true);

    // Toast with a one-tap discard. Sonner has a built-in action
    // button shape we can use.
    toast(toastLabel, {
      duration: 5000,
      action: {
        label: 'Discard',
        onClick: () => safeClear(key),
      },
    });

  }, [enabled, key, staleMs, toastLabel]);

  // PERSIST — runs (debounced) whenever the value changes after the
  // initial restore. We skip persisting the all-empty state so we
  // don't write a blank draft over a real one when the parent
  // initializes the form.
  useEffect(() => {
    if (!enabled || !key) return;
    // Avoid stomping over a real draft on first mount before the
    // parent has had a chance to call onRestore. The restoredRef gate
    // ensures we've at least attempted a restore before we start
    // overwriting.
    if (!restoredRef.current) return;

    const isEmpty = isShallowEmpty(value);
    if (isEmpty) {
      // Empty form → clear any prior draft. The user blanked the
      // form deliberately; preserving the old draft would feel like
      // a ghost.
      safeClear(key);
      return;
    }

    const t = setTimeout(() => {
      safeWrite(key, {
        savedAt: new Date().toISOString(),
        value,
      });
    }, debounceMs);

    return () => clearTimeout(t);
  }, [enabled, key, value, debounceMs]);

  return { clear, hasRestored };
}

/**
 * "Empty" means: every property in the shape is null/undefined/''/
 * or an empty array. Used to suppress persisting a freshly-initialized
 * blank form on top of a real draft.
 */
function isShallowEmpty(value) {
  if (value == null) return true;
  if (typeof value !== 'object') return value === '' || value === 0;
  if (Array.isArray(value)) return value.length === 0;
  for (const v of Object.values(value)) {
    if (v == null) continue;
    if (typeof v === 'string' && v.length === 0) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'object' && Object.keys(v).length === 0) continue;
    return false;
  }
  return true;
}
