// src/lib/scrollLock.js
//
// The page behind an open menu must not move. One shared, reference-counted
// lock for the whole app — every sheet, menu, panel and modal we built by
// hand goes through `useBodyScrollLock`, which calls in here.
//
// Why not just `body { overflow: hidden }` — which is what this app did for
// a year, in a hook and in seven hand-rolled copies of it:
//
//   • It is a *propagation* rule, not a lock. The body's overflow only
//     reaches the viewport while the root element's own overflow is
//     `visible`; anything that touches `html`'s overflow (a theme layer, a
//     vendor's scroll-lock style tag, a stray utility class) silently
//     un-locks the page and nothing anywhere reports it.
//   • On iOS it does not stop a touch drag of the document. Safari keeps
//     panning the page under a `fixed` overlay, which is exactly the bug
//     this file exists to fix: a drag inside a menu that has nothing left
//     to scroll — or no scrollable content at all — falls through and
//     scrolls the Dashboard behind it.
//   • It loses the scroll position whenever anything else re-lays out the
//     document while the overlay is open.
//
// So: pin the body with `position: fixed` at `top: -scrollY`. A fixed body
// contributes nothing to the document's scrollable overflow, so there is no
// scroll left to steal — no touch, wheel, keyboard or programmatic path
// moves the page. `top` holds the page visually exactly where it was, which
// matters because several of our menus (ProfileMenu especially) have no
// backdrop and the page is still visible around them: a jump would be
// obvious. On release the offset is handed back to `window.scrollTo`.
//
// Reference counting is what makes it safe to stack: a sheet opened from
// inside another sheet must not un-lock the page when the inner one closes.
// The snapshot is taken on the 0→1 transition and restored on 1→0 only, so
// N nested overlays produce exactly one lock and one restore.
//
// Note that `position: fixed` on the body does NOT create a containing block
// for fixed descendants — only transform/filter/perspective/contain do — so
// every `fixed inset-0` overlay in the app keeps positioning against the
// viewport while this is active.

// Widest plausible platform scrollbar. Anything above this is the viewport
// being scaled, not a gutter to reserve — see the measurement below.
const MAX_GUTTER = 32;

let depth = 0;
let saved = null;

function canLock() {
  return typeof document !== 'undefined' && !!document.body;
}

/**
 * Pin the document. Idempotent per caller: pair every call with exactly one
 * `unlockBodyScroll()`. Returns nothing — callers should not need to know
 * whether they were the one that actually applied the styles.
 */
export function lockBodyScroll() {
  if (!canLock()) return;

  depth += 1;
  if (depth > 1) return; // already pinned by an overlay further out

  const body = document.body;
  const html = document.documentElement;
  const scrollY = window.scrollY || html.scrollTop || 0;

  // Desktop only: `html` keeps the platform scrollbar (index.css excludes
  // html/body from the app-wide scrollbar hiding). Pinning the body removes
  // it, so reserve the same gutter as padding or the whole page shifts
  // sideways the moment a menu opens. iOS reports 0 here and pays nothing.
  //
  // Clamped to MAX_GUTTER because this difference is only a *scrollbar* when
  // nothing else is scaling the viewport. Measured in the in-app browser
  // pane mid-resize it read 48px — innerWidth 423 against clientWidth 375 —
  // which as padding would have indented the whole page by half a thumb's
  // width. A real platform scrollbar is 15–17px and never approaches 32.
  const rawGutter = window.innerWidth - html.clientWidth;
  const gutter = rawGutter > 0 && rawGutter <= MAX_GUTTER ? rawGutter : 0;

  saved = {
    scrollY,
    body: {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    },
    htmlOverflow: html.style.overflow,
    htmlScrollBehavior: html.style.scrollBehavior,
  };

  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  if (gutter > 0) {
    // Preflight sets border-box on everything, so this shrinks the content
    // box rather than widening the element.
    body.style.paddingRight = `${gutter}px`;
  }
  html.style.overflow = 'hidden';
}

/**
 * Release one lock. The page only moves again — and only returns to its
 * scroll position — once the outermost overlay has released.
 */
export function unlockBodyScroll() {
  if (!canLock() || depth === 0) return;

  depth -= 1;
  if (depth > 0) return; // an overlay further out still wants it pinned

  const snapshot = saved;
  saved = null;
  if (!snapshot) return;

  const body = document.body;
  const html = document.documentElement;

  body.style.position = snapshot.body.position;
  body.style.top = snapshot.body.top;
  body.style.left = snapshot.body.left;
  body.style.right = snapshot.body.right;
  body.style.width = snapshot.body.width;
  body.style.overflow = snapshot.body.overflow;
  body.style.paddingRight = snapshot.body.paddingRight;
  html.style.overflow = snapshot.htmlOverflow;

  // Restore before the browser can paint the un-pinned page at scroll 0.
  // Forced to `auto` in case a smooth-scroll rule is ever added to html —
  // animating back to where the user already was reads as a bug.
  html.style.scrollBehavior = 'auto';
  window.scrollTo(0, snapshot.scrollY);
  html.style.scrollBehavior = snapshot.htmlScrollBehavior;
}

/** True while at least one overlay holds the lock. Exposed for tests. */
export function isBodyScrollLocked() {
  return depth > 0;
}

/** Test-only escape hatch — drops every outstanding lock. */
export function __resetBodyScrollLock() {
  depth = 0;
  saved = null;
}
