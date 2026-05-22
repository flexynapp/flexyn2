// src/hooks/useScrollPosition.js
//
// Tracks window scroll position with rAF throttling so consumers can react
// to scroll without burning CPU. Returns the current scrollY value.
//
// Used by BackToTopButton to decide visibility, and by any future
// scroll-driven UI (hide-header-on-scroll, parallax, etc.).

import { useEffect, useState } from 'react';

export function useScrollPosition() {
  const [scrollY, setScrollY] = useState(
    typeof window !== 'undefined' ? window.scrollY : 0
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let rafId = null;
    const onScroll = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        setScrollY(window.scrollY);
        rafId = null;
      });
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, []);

  return scrollY;
}
