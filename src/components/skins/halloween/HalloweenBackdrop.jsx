// src/components/skins/halloween/HalloweenBackdrop.jsx
//
// The Halloween skin's `Backdrop` slot: a night scene fixed BEHIND the page.
// Cards are opaque, so it only shows through the gaps between them, the
// space under a short page and the desktop gutters outside the capped shell.
// That is the point: it fills empty space without covering anything.
//
// Everything is drawn at low opacity in --foreground (and the moon in
// --primary), so text that sits on the bare background between cards keeps
// its contrast. The graveyard sits on top of the bottom nav on phones and on
// the window's floor on desktop.
//
// -z-10 puts it under non-positioned page content in the root stacking
// context. That only works because Layout's shell is transparent while a
// skin is on (the `.app-shell` rule in index.css); the body still paints the
// same background colour underneath.

// Deterministic star field, in viewBox units of a 100x60 sky.
const STARS = [
  [8, 6], [19, 14], [27, 4], [36, 19], [44, 9], [55, 16], [63, 5], [71, 22],
  [12, 27], [30, 31], [48, 26], [58, 35], [83, 30], [92, 12], [4, 40], [76, 41],
];

// Fence pickets between two graves.
const PICKETS = Array.from({ length: 10 }, (_, i) => 206 + i * 7);

export default function HalloweenBackdrop() {
  return (
    <div className="fixed inset-0 -z-10 pointer-events-none text-foreground" aria-hidden="true" data-testid="halloween-backdrop">
      <svg className="absolute inset-x-0 top-0 w-full h-[60vh]" viewBox="0 0 100 60" preserveAspectRatio="xMidYMin slice">
        {STARS.map(([x, y], i) => (
          <circle
            key={`${x}-${y}`}
            cx={x}
            cy={y}
            r={i % 3 === 0 ? 0.45 : 0.3}
            fill="currentColor"
            className="hw-twinkle"
            style={{ opacity: 0.22, animationDelay: `${(i % 5) * 0.7}s` }}
          />
        ))}
      </svg>

      {/* Moon. Primary at low opacity reads as a harvest moon on dark and a
          pale sun-disc on parchment; no new hue. */}
      <svg className="absolute top-[22%] end-[8%] w-24 h-24" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="48" fill="hsl(var(--primary))" opacity="0.07" />
        <circle cx="50" cy="50" r="36" fill="hsl(var(--primary))" opacity="0.2" />
        <circle cx="40" cy="42" r="6" fill="currentColor" opacity="0.05" />
        <circle cx="60" cy="58" r="8" fill="currentColor" opacity="0.05" />
        <circle cx="58" cy="36" r="3.5" fill="currentColor" opacity="0.05" />
      </svg>

      {/* Graveyard. Cropped at the sides on wide screens rather than scaled
          up, so it never becomes a wall. */}
      <svg
        className="absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0 w-full h-[clamp(110px,38vw,170px)]"
        viewBox="0 0 400 160"
        preserveAspectRatio="xMidYMax slice"
      >
        <g fill="currentColor" opacity="0.1">
          <path d="M0 160L0 128Q60 110 130 122T260 118T400 124L400 160Z" />
          <path d="M40 128v-22a10 10 0 0 1 20 0v22Z" />
          <path d="M96 124v-30h-8v-6h8v-8h6v8h8v6h-8v30Z" />
          <path d="M150 122v-18a13 13 0 0 1 26 0v18Z" transform="rotate(-6 163 122)" />
          <path d="M300 122v-16a9 9 0 0 1 18 0v16Z" />
          {PICKETS.map((x) => (
            <path key={x} d={`M${x} 121v-18l2.5-4 2.5 4v18Z`} />
          ))}
          <path d="M204 107h70v2.5h-70ZM204 116h70v2.5h-70Z" />
          <path d="M352 124C354 100 350 80 356 60L360 60C358 82 362 100 363 124Z" />
        </g>
        <g fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity="0.1">
          <path d="M357 70Q340 55 326 52L318 44M358 64Q372 48 388 44L394 36M356 84Q344 76 334 78M361 78Q374 72 384 74" />
        </g>
      </svg>
    </div>
  );
}
