import { useState, useRef, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

const THRESHOLD = 72; // px to pull before triggering

export default function PullToRefresh({ children }) {
  const queryClient = useQueryClient();
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const pulling = useRef(false);
  const containerRef = useRef(null);
  // Mirror state into refs so the native passive listeners (no React
  // re-render binding) read the latest values without re-attaching.
  const refreshingRef = useRef(refreshing);
  const pullYRef = useRef(pullY);
  useEffect(() => { refreshingRef.current = refreshing; }, [refreshing]);
  useEffect(() => { pullYRef.current = pullY; }, [pullY]);

  // Attach touch listeners as native + passive so Chrome can scroll
  // synchronously instead of waiting to see if we'll preventDefault.
  // React's onTouchMove synthetic-event binding doesn't expose the
  // {passive: true} option and the browser conservatively assumes
  // non-passive, costing us scroll smoothness. We never preventDefault
  // in any of these handlers, so passive is correct.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onTouchStart = (e) => {
      if (window.scrollY !== 0) return;
      startY.current = e.touches[0].clientY;
      pulling.current = true;
    };

    const onTouchMove = (e) => {
      if (!pulling.current || startY.current === null || refreshingRef.current) return;
      const delta = e.touches[0].clientY - startY.current;
      if (delta <= 0) {
        setPullY(0);
        return;
      }
      // Proper rubber-band damping: linear up to the threshold, then
      // square-root falloff so the user feels increasing resistance as
      // they pull farther.
      let damped;
      if (delta <= THRESHOLD) {
        damped = delta * 0.55;
      } else {
        const over = delta - THRESHOLD;
        damped = THRESHOLD * 0.55 + Math.sqrt(over) * 4;
      }
      setPullY(Math.min(damped, THRESHOLD + 40));
    };

    const onTouchEnd = async () => {
      if (!pulling.current) return;
      pulling.current = false;
      startY.current = null;

      if (pullYRef.current >= THRESHOLD * 0.45) {
        setRefreshing(true);
        setPullY(THRESHOLD);
        await queryClient.invalidateQueries();
        await new Promise(r => setTimeout(r, 600));
        setRefreshing(false);
      }
      setPullY(0);
    };

    const opts = { passive: true };
    el.addEventListener('touchstart', onTouchStart, opts);
    el.addEventListener('touchmove',  onTouchMove,  opts);
    el.addEventListener('touchend',   onTouchEnd,   opts);
    return () => {
      el.removeEventListener('touchstart', onTouchStart, opts);
      el.removeEventListener('touchmove',  onTouchMove,  opts);
      el.removeEventListener('touchend',   onTouchEnd,   opts);
    };
  }, [queryClient]);

  const progress = Math.min(pullY / (THRESHOLD * 0.45), 1);

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col md:contents"
    >
      {/* Indicator — only visible on mobile */}
      <div
        className="md:hidden absolute start-0 end-0 flex items-center justify-center pointer-events-none z-10 overflow-hidden transition-[height] duration-150"
        style={{ height: pullY > 0 || refreshing ? Math.max(pullY, refreshing ? THRESHOLD : 0) : 0 }}
      >
        <RefreshCw
          className="w-5 h-5 text-primary transition-transform"
          style={{
            opacity: progress,
            transform: `rotate(${refreshing ? 'none' : `${progress * 180}deg`})`,
            animation: refreshing ? 'spin 0.8s linear infinite' : 'none',
          }}
        />
      </div>

      {/* Actual content pushed down while pulling */}
      <div
        className="flex flex-col transition-transform duration-150"
        style={{ transform: pullY > 0 ? `translateY(${pullY}px)` : 'none' }}
      >
        {children}
      </div>
    </div>
  );
}