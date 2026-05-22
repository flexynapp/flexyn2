// src/hooks/useScrollRestoration.js
//
// Per-route scroll-position memory backed by sessionStorage. Solves
// the "I scrolled 30% into Hub feed, tapped a post, tapped back,
// and lost my place" problem.
//
// USAGE
//
//   function HubFeed() {
//     const scrollRef = useScrollRestoration('hub-feed', { ready });
//     return <div ref={scrollRef}>...</div>;
//   }
//
//   // For window-scrolled pages, pass `{ window: true }`:
//   useScrollRestoration('progress', { window: true, ready: !isLoading });
//
// PROPS
//
//   key        Unique-per-list key. Conventionally route + tab id.
//   ready      Optional boolean — wait for data to land before
//              restoring. Without this, restoring to 1000px on an
//              empty container would land mid-blank-space.
//   window     When true, save+restore window.scrollY instead of an
//              inner-scroll container. The hook returns no ref in
//              this mode.
//   maxAge     Drop stored positions older than this (ms). Default
//              30 minutes — anything older is probably a stale
//              session and the user wants to start at top.
//
// Strategy:
//   • Save scroll position on scroll (debounced 200ms) + on unmount.
//   • Restore on mount once `ready` is true (or immediately if no
//     `ready` was passed).
//   • Skip the restore if the saved position is 0 — that's the
//     default state, no work needed.
//   • Skip the restore if the position is older than `maxAge`.

import { useEffect, useRef } from 'react';

const PREFIX = 'flexyn.scrollPos.';
const DEFAULT_MAX_AGE_MS = 30 * 60 * 1000;

function safeRead(key) {
  try {
    const raw = sessionStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.y !== 'number' || typeof parsed?.t !== 'number') return null;
    return parsed;
  } catch { return null; }
}

function safeWrite(key, y) {
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ y, t: Date.now() }));
  } catch { /* best-effort */ }
}

export function useScrollRestoration(key, { ready = true, window: useWindow = false, maxAge = DEFAULT_MAX_AGE_MS } = {}) {
  const elementRef = useRef(null);
  const restoredRef = useRef(false);
  const saveTimerRef = useRef(null);

  // RESTORE on mount once `ready` flips true.
  useEffect(() => {
    if (!key || !ready) return;
    if (restoredRef.current) return;

    const saved = safeRead(key);
    if (!saved) {
      restoredRef.current = true;
      return;
    }
    if (saved.t && Date.now() - saved.t > maxAge) {
      restoredRef.current = true;
      return;
    }
    if (!saved.y) {
      restoredRef.current = true;
      return;
    }

    // Wait one paint so the list content has actually rendered.
    requestAnimationFrame(() => {
      if (useWindow) {
        window.scrollTo({ top: saved.y, behavior: 'auto' });
      } else if (elementRef.current) {
        elementRef.current.scrollTop = saved.y;
      }
      restoredRef.current = true;
    });
  }, [key, ready, useWindow, maxAge]);

  // SAVE on scroll (debounced) + on unmount.
  useEffect(() => {
    if (!key) return;

    const getY = () =>
      useWindow ? window.scrollY : (elementRef.current?.scrollTop ?? 0);

    const persist = () => {
      const y = getY();
      safeWrite(key, y);
    };

    const onScroll = () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(persist, 200);
    };

    const target = useWindow ? window : elementRef.current;
    if (!target) return undefined;
    target.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      target.removeEventListener('scroll', onScroll);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      // Final flush on unmount so the next mount has the latest pos.
      persist();
    };
  }, [key, useWindow]);

  return elementRef;
}
