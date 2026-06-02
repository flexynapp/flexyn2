import { useState, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';

const THRESHOLD = 72; // px to pull before triggering

export default function PullToRefresh({ children }) {
  const queryClient = useQueryClient();
  const [pullY, setPullY] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const pulling = useRef(false);

  const onTouchStart = useCallback((e) => {
    // Only activate when scrolled to the very top
    if (window.scrollY !== 0) return;
    startY.current = e.touches[0].clientY;
    pulling.current = true;
  }, []);

  const onTouchMove = useCallback((e) => {
    if (!pulling.current || startY.current === null || refreshing) return;
    const delta = e.touches[0].clientY - startY.current;
    if (delta <= 0) {
      setPullY(0);
      return;
    }
    // Proper rubber-band damping: linear up to the threshold, then
    // square-root falloff so the user feels increasing resistance as
    // they pull farther. Previous formula (delta * 0.45 hard-capped at
    // THRESHOLD+20) snapped to a max immediately and felt mechanical
    // — no tactile signal that the user was nearing the limit.
    let damped;
    if (delta <= THRESHOLD) {
      damped = delta * 0.55;
    } else {
      const over = delta - THRESHOLD;
      damped = THRESHOLD * 0.55 + Math.sqrt(over) * 4;
    }
    setPullY(Math.min(damped, THRESHOLD + 40));
  }, [refreshing]);

  const onTouchEnd = useCallback(async () => {
    if (!pulling.current) return;
    pulling.current = false;
    startY.current = null;

    if (pullY >= THRESHOLD * 0.45) {
      setRefreshing(true);
      setPullY(THRESHOLD);
      await queryClient.invalidateQueries();
      // Small delay so the spinner is visible
      await new Promise(r => setTimeout(r, 600));
      setRefreshing(false);
    }
    setPullY(0);
  }, [pullY, queryClient]);

  const progress = Math.min(pullY / (THRESHOLD * 0.45), 1);

  return (
    <div
      className="relative flex flex-col md:contents"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Indicator — only visible on mobile */}
      <div
        className="md:hidden absolute left-0 right-0 flex items-center justify-center pointer-events-none z-10 overflow-hidden transition-[height] duration-150"
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