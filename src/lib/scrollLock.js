// src/lib/scrollLock.js
//
// The page behind an open menu must not move. One shared, reference-counted
// lock for the whole app — every sheet, menu, panel and modal we built by
// hand goes through `useBodyScrollLock`, which calls in here.
//
// ── Why not `body { overflow: hidden }` on its own ──────────────────────
// That is what this app did for a year, in a hook and in seven copy-pasted
// duplicates of it, and it does not hold on iOS: Safari keeps panning the
// document under a `fixed` overlay because a touch drag is not governed by
// overflow. It is also a *propagation* rule — the body's overflow only
// reaches the viewport while the root element's overflow is `visible` — so
// anything that touches html's overflow silently un-locks the page.
//
// ── Why not pin the body with `position: fixed` ─────────────────────────
// The obvious fix is `position: fixed; top: -scrollY`, and it does stop the
// page dead. It was tried here and reverted, because pinning RELAYOUTS the
// whole document and that has consequences no screenshot shows:
//
//   • `window.scrollY` becomes 0 while an overlay is open, with no scroll
//     event to announce it. Everything that reads it is then wrong —
//     Layout's auto-hiding bottom nav and BackToTopButton both do, and the
//     nav ended up hidden with the button stranded on top of an open sheet.
//   • The document's scrollable overflow collapses to the viewport, so the
//     `window.scrollTo` that hands the position back on release depends on
//     the engine having re-laid-out the document synchronously first.
//     Chrome does. WebKit is where the sheet came back with the page
//     scrolled to the bottom and the sheet gone.
//   • Every `fixed` overlay is measured against a document that just
//     changed shape underneath it, mid-gesture.
//
// ── What this does instead ─────────────────────────────────────────────
// The same thing Radix's dialogs do — they use `react-remove-scroll`, they
// are already in this app, and they hold on the device this bug was
// reported from. Two parts, neither of which moves the document:
//
//   1. `body { overflow: hidden }` (+ a scrollbar gutter on desktop).
//      Kills wheel, keyboard and scrollbar scrolling of the page. The
//      scroll POSITION is untouched, so `window.scrollY` stays honest and
//      there is nothing to restore on release.
//   2. Non-passive `touchmove` / `wheel` listeners that cancel any gesture
//      with nowhere to go. A drag inside the overlay's own scroller still
//      scrolls it; a drag on the page behind — or one that has run the
//      overlay's scroller to its end — is cancelled instead of chaining.
//      This is the half that actually stops iOS.
//
// Reference counting makes it safe to stack: a sheet opened from inside
// another sheet must not un-lock the page when the inner one closes, so the
// styles are applied on the 0→1 transition and removed on 1→0 only.

// Widest plausible platform scrollbar. Anything above this is the viewport
// being scaled rather than a gutter to reserve — measured in the in-app
// browser pane mid-resize it read 48px, which as padding would have
// indented the whole page every time a menu opened.
const MAX_GUTTER = 32;

let depth = 0;
let saved = null;
let touchX = 0;
let touchY = 0;

function canLock() {
  return typeof document !== 'undefined' && !!document.body;
}

/**
 * Can this element still scroll `delta` along `axis`? Only elements that
 * actually opt into scrolling count — a `visible`/`hidden` box with
 * overflowing content is not a scroller, it is a clip.
 */
function canScroll(el, style, axis, delta) {
  const overflow = axis === 'y' ? style.overflowY : style.overflowX;
  if (overflow !== 'auto' && overflow !== 'scroll' && overflow !== 'overlay') return false;

  const max = axis === 'y'
    ? el.scrollHeight - el.clientHeight
    : el.scrollWidth - el.clientWidth;
  if (max <= 1) return false;

  const pos = axis === 'y' ? el.scrollTop : el.scrollLeft;
  // 1px of slack: sub-pixel layout leaves scrollTop a hair short of max on
  // plenty of real content, and treating that as "still has room" is the
  // safe direction — it lets a real scroll through rather than eating it.
  return delta < 0 ? pos > 1 : pos < max - 1;
}

/**
 * Would the browser itself pan this element along `axis`? If not, some
 * script owns the gesture — framer-motion's `drag`, our pull-to-dismiss
 * handle, maplibre's canvas, the avatar cropper — and cancelling the
 * touchmove underneath it would fight that library for the same finger.
 *
 * The map is why this is axis-aware rather than a `=== 'none'` check.
 * maplibre marks its canvas `touch-action: pinch-zoom` while drag-pan is
 * on: not `none`, but it still means "I handle dragging". Against the
 * simpler check every pan of the gym map would have been cancelled.
 * Conversely `useSwipeToDelete` sets `pan-y`, which really does mean the
 * browser still owns vertical — so a downward drag there must still be
 * judged on whether anything can scroll.
 */
function browserPansAxis(touchAction, axis) {
  // jsdom reports '' for unset; a real engine always computes a keyword.
  const value = touchAction || 'auto';
  if (value === 'auto' || value === 'manipulation') return true;
  return axis === 'y'
    ? /\bpan-(y|up|down)\b/.test(value)
    : /\bpan-(x|left|right)\b/.test(value);
}

/**
 * Does this gesture have anywhere to go that ISN'T the page? Walks up from
 * the touch target looking for a scroller with room left in the gesture's
 * dominant axis, stopping at <body> — the document is exactly what we are
 * refusing to scroll.
 */
function gestureHasRoom(target, dx, dy) {
  const axis = Math.abs(dy) >= Math.abs(dx) ? 'y' : 'x';
  const delta = axis === 'y' ? dy : dx;
  if (delta === 0) return true;

  let el = target instanceof Element ? target : null;
  while (el && el !== document.body && el !== document.documentElement) {
    const style = getComputedStyle(el);
    if (!browserPansAxis(style.touchAction, axis)) return true;
    if (canScroll(el, style, axis, delta)) return true;
    el = el.parentElement;
  }
  return false;
}

function onTouchStart(e) {
  if (e.touches.length !== 1) return;
  touchX = e.touches[0].clientX;
  touchY = e.touches[0].clientY;
}

function onTouchMove(e) {
  // Two fingers is a pinch-zoom. Accessibility, not scrolling — never
  // interfere with it.
  if (e.touches.length !== 1) return;
  const dx = touchX - e.touches[0].clientX;
  const dy = touchY - e.touches[0].clientY;
  if (gestureHasRoom(e.target, dx, dy)) return;
  if (e.cancelable) e.preventDefault();
}

function onWheel(e) {
  if (gestureHasRoom(e.target, e.deltaX, e.deltaY)) return;
  if (e.cancelable) e.preventDefault();
}

// `passive: false` is the whole point — a passive listener may not
// preventDefault, which is the only thing that stops the page on iOS.
const NON_PASSIVE = { passive: false, capture: false };

/**
 * Hold the page still. Pair every call with exactly one
 * `unlockBodyScroll()`; nesting is reference-counted.
 */
export function lockBodyScroll() {
  if (!canLock()) return;

  depth += 1;
  if (depth > 1) return; // already held by an overlay further out

  const body = document.body;
  const html = document.documentElement;

  // Desktop only: html keeps the platform scrollbar (index.css excludes
  // html/body from the app-wide scrollbar hiding), and hiding the overflow
  // takes it away. Reserve the same width as padding or the page jumps
  // sideways the moment a menu opens. iOS reports 0 here and pays nothing.
  const rawGutter = window.innerWidth - html.clientWidth;
  const gutter = rawGutter > 0 && rawGutter <= MAX_GUTTER ? rawGutter : 0;

  saved = {
    overflow: body.style.overflow,
    paddingRight: body.style.paddingRight,
  };

  // Deliberately NOT setting overscroll-behavior here, which is what Radix's
  // copy of this does. index.css already pins `body { overscroll-behavior:
  // none }` app-wide, and `none` is the stricter of the two — writing an
  // inline `contain` would override the stylesheet with something weaker
  // for exactly as long as an overlay is open.
  body.style.overflow = 'hidden';
  if (gutter > 0) {
    // Preflight sets border-box on everything, so this shrinks the content
    // box rather than widening the element.
    body.style.paddingRight = `${gutter}px`;
  }

  document.addEventListener('touchstart', onTouchStart, NON_PASSIVE);
  document.addEventListener('touchmove', onTouchMove, NON_PASSIVE);
  document.addEventListener('wheel', onWheel, NON_PASSIVE);
}

/**
 * Release one lock. The page only moves again once the outermost overlay
 * has released. Nothing is scrolled here — the position was never taken
 * away, which is the point of doing it this way.
 */
export function unlockBodyScroll() {
  if (!canLock() || depth === 0) return;

  depth -= 1;
  if (depth > 0) return; // an overlay further out still wants it held

  const snapshot = saved;
  saved = null;

  document.removeEventListener('touchstart', onTouchStart, NON_PASSIVE);
  document.removeEventListener('touchmove', onTouchMove, NON_PASSIVE);
  document.removeEventListener('wheel', onWheel, NON_PASSIVE);

  if (!snapshot) return;
  const body = document.body;
  body.style.overflow = snapshot.overflow;
  body.style.paddingRight = snapshot.paddingRight;
}

/** True while at least one overlay holds the lock. Exposed for tests. */
export function isBodyScrollLocked() {
  return depth > 0;
}

/** Test-only escape hatch — drops every outstanding lock. */
export function __resetBodyScrollLock() {
  if (canLock()) {
    document.removeEventListener('touchstart', onTouchStart, NON_PASSIVE);
    document.removeEventListener('touchmove', onTouchMove, NON_PASSIVE);
    document.removeEventListener('wheel', onWheel, NON_PASSIVE);
  }
  depth = 0;
  saved = null;
}
