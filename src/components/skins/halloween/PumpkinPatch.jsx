// src/components/skins/halloween/PumpkinPatch.jsx
//
// The Halloween skin's `NavEdge` slot: a row of pumpkins along the top edge
// of the bottom nav. The slot lives INSIDE the nav (Layout.jsx) rather than
// in the fixed overlay, so it slides away with the nav on scroll instead of
// being left floating at the bottom of the screen.
//
// It never covers content: the skin declares --skin-nav-edge (36px) in
// halloween.css, Layout adds that to the page's bottom padding and to
// --nav-h, and this row is exactly that tall with overflow clipped, so it
// cannot outgrow the room it reserved.

import PumpkinMark from './PumpkinMark';

// Sizes in px. Mixed so the row reads as a patch, not a pattern; the big
// ones get carved faces. Enough to fill a 375px phone with small gaps, and
// justify-between spreads them on anything wider.
export const PATCH = [30, 18, 24, 34, 16, 26, 20, 32, 18, 24, 28, 16, 30];

export default function PumpkinPatch() {
  return (
    <div
      className="absolute bottom-full inset-x-0 h-[var(--skin-nav-edge,0px)] overflow-hidden px-1 flex items-end justify-between pointer-events-none"
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
