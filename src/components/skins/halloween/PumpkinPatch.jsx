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

// Every pumpkin sits ON the edge, whatever its size. PumpkinMark's body ends
// at y=21 of its 24-unit box, so a flat -mb left big pumpkins hovering a few
// px up while small ones touched down. Each is pulled down by its own empty
// strip plus SEAT px, burying the body in the clipped edge the way a
// graveyard figure sits in the ground. skinGrounding.test.js checks it.
export const PUMPKIN_FOOT = 21 / 24;
export const SEAT = 1;
export const seatOffset = (size) => -(size * (1 - PUMPKIN_FOOT) + SEAT);

// Held at half strength so the graveyard's lit jack-o'-lanterns are the
// brightest thing in the scene. At full orange these unlit pumpkins sat in
// front of the lanterns and outshone them, and the lanterns cannot get
// brighter without failing text contrast (skinContrast.test.js).
// Set on the row, not on each pumpkin: opacity on a parent fades the row
// as one layer, so the vine stays hidden behind each body instead of
// showing through a see-through pumpkin.
export const PATCH_OPACITY = 0.5;

export default function PumpkinPatch() {
  return (
    <div
      className="absolute bottom-full inset-x-0 h-[var(--skin-nav-edge,0px)] overflow-hidden px-1 flex items-end justify-between pointer-events-none"
      aria-hidden="true"
      style={{ opacity: PATCH_OPACITY }}
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
          className="relative shrink-0"
          style={{ width: size, height: size, marginBottom: seatOffset(size) }}
        />
      ))}
    </div>
  );
}
