// src/components/seasonal/PumpkinPatch.jsx
//
// A row of pumpkins sitting along the top edge of the bottom nav while the
// Halloween skin is on. Rendered INSIDE the nav (Layout.jsx) rather than in
// the fixed decor layer, so it slides away with the nav on scroll instead
// of being left floating at the bottom of the screen.
//
// It overlaps the last ~32px of page content above the nav. That content
// scrolls past it, and pointer-events none means it can never eat a tap.

import { useTheme } from '@/lib/ThemeContext';
import PumpkinMark from './PumpkinMark';

// Sizes in px. Mixed so the row reads as a patch, not a pattern; the big
// ones get carved faces. Enough to fill a 375px phone with small gaps, and
// justify-between spreads them on anything wider.
const PATCH = [30, 18, 24, 34, 16, 26, 20, 32, 18, 24, 28, 16, 30];

export default function PumpkinPatch() {
  const theme = useTheme();
  if (!theme?.halloween || !theme?.halloweenAvailable) return null;

  return (
    <div
      className="absolute bottom-full inset-x-0 px-1 flex items-end justify-between pointer-events-none"
      aria-hidden="true"
      data-testid="pumpkin-patch"
    >
      {/* The vine the patch grows on, drawn behind the pumpkins. */}
      <svg className="absolute inset-x-0 bottom-0 w-full h-3" viewBox="0 0 100 12" preserveAspectRatio="none" aria-hidden="true">
        <path
          d="M0 10Q6 4 12 9T25 9T38 8T50 10T62 8T75 9T88 8T100 10"
          fill="none"
          stroke="hsl(var(--foreground) / 0.35)"
          strokeWidth="1.2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      {PATCH.map((size, i) => (
        <PumpkinMark
          key={i}
          face={size >= 24}
          className="relative shrink-0 -mb-0.5"
          style={{ width: size, height: size }}
        />
      ))}
    </div>
  );
}
