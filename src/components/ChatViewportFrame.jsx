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

// Matches the bottom-nav clearance baked into Layout's <main>
// (`pb-[calc(4rem+env(safe-area-inset-bottom))]`).
const NAV_CLEARANCE_PX = 64;

// env(safe-area-inset-bottom) isn't readable directly in JS — probe it once
// per measurement with a throwaway fixed element.
function readSafeAreaBottom() {
  try {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;bottom:0;left:0;width:0;height:env(safe-area-inset-bottom,0px);pointer-events:none;visibility:hidden;';
    document.body.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    document.body.removeChild(probe);
    return Number.isFinite(h) ? h : 0;
  } catch {
    return 0;
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
      const avail = vh - top - (NAV_CLEARANCE_PX + readSafeAreaBottom());
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
