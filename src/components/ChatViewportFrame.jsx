// src/components/ChatViewportFrame.jsx
//
// A height wrapper for chat-style panels (DM chat, crew chat, crew
// discovery/creation) that must fill the space from their own top edge down
// to just above the fixed bottom nav — then scroll INTERNALLY, so the page
// body never grows into a scrollable empty void below the composer.
//
// Why this exists: panels previously hard-coded `height: calc(100dvh - 200px)`.
// That 200px only matched the Hub sub-header context. On the bare Messages
// page (much less chrome above) the same value left a tall dead zone you could
// scroll into; in Hub it pushed the composer down behind the nav. Measuring
// the panel's actual top makes it correct in every context with no magic
// number.

import { useLayoutEffect, useRef, useState } from 'react';

// Fallback clearance if the bottom nav can't be measured (matches Layout's
// <main> pb of 4rem). Normally we reserve the nav's REAL height instead —
// Layout's <main> pb (64px) is shorter than the actual labeled tab bar
// (~81px incl. the iOS safe-area inset), so a fixed-height chat frame that
// trusted the 64px number left its composer tucked under the nav.
const NAV_CLEARANCE_PX = 64;

// Small breathing gap so the composer doesn't sit flush against the nav.
const NAV_BREATHING_GAP_PX = 12;

// How much the fixed bottom nav actually covers at the bottom of the viewport,
// plus a little breathing room. We read the real element's height (which
// already includes its safe-area padding) so the composer clears it exactly.
// Returns 0 on the desktop side-nav layout (nav is `lg:hidden`) or any
// full-screen chat with no nav.
function readBottomNavClearance() {
  try {
    const nav = document.querySelector('nav.fixed.bottom-0');
    if (!nav) return 0;
    if (getComputedStyle(nav).display === 'none') return 0; // desktop / hidden
    const h = nav.offsetHeight; // stable even while the nav is transiently translated off-screen
    return (h > 0 ? h : NAV_CLEARANCE_PX) + NAV_BREATHING_GAP_PX;
  } catch {
    return NAV_CLEARANCE_PX;
  }
}

export default function ChatViewportFrame({ className = '', minHeight = 360, children }) {
  const ref = useRef(null);
  const [height, setHeight] = useState(minHeight);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;

    const compute = () => {
      const top = el.getBoundingClientRect().top; // viewport-relative
      const vh = window.visualViewport?.height || window.innerHeight;
      const avail = vh - top - readBottomNavClearance();
      setHeight(Math.max(minHeight, Math.round(avail)));
    };

    compute();
    // Re-measure when the document or viewport resizes (orientation change,
    // mobile URL-bar collapse, content above the panel growing/shrinking).
    const ro = new ResizeObserver(compute);
    ro.observe(document.documentElement);
    window.addEventListener('resize', compute);
    window.visualViewport?.addEventListener('resize', compute);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', compute);
      window.visualViewport?.removeEventListener('resize', compute);
    };
  }, [minHeight]);

  return (
    <div ref={ref} className={`relative ${className}`} style={{ height, minHeight }}>
      {children}
    </div>
  );
}
