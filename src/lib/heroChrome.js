// src/lib/heroChrome.js
//
// The accent lookup HeroPager colours its pagination dots with.
//
// This file used to hold the whole hero carousel CHROME: the smoothstep tint
// and band-to-page fade the Dashboard band painted, the slide watermark
// geometry and the chevron gutter. Dashboard, Progress and Nutrition all
// replaced their carousels with a focal goal on 2026-09-27 (hero option D,
// src/components/glance/), and nothing paints a band any more, so all of
// that went with HeroSlideshow. Its reasoning (Mach banding at a gradient's
// last stop, the watermark clipped by a padded pager) is in git history.
//
// No state and no JSX, so it can be imported from a component or a test
// without dragging React in.

// Maps a slide's iconBg utility to the HSL accent used for its gradient
// tint AND its pagination dots, so a slide with no explicit `color` still
// colours its dots to match.
//
// This was nine entries, each a private HSL triplet — one hue per slide
// (amber, emerald, purple, orange, cyan, blue, sky, rose, magenta). A
// carousel where every slide repaints the chrome in its own colour is
// the "every block gets its own accent" pattern on a timer, and it was
// the single biggest source of hue sprawl left on the page.
//
// Now four entries keyed on the four budget tokens, holding `var(--x)`
// rather than literals so `hsl(${accent})` and `hsl(${accent} / 0.25)`
// both still work and the dots theme with everything else.
//
// This ALSO fixed a live bug: once the slide `iconBg` values were moved
// onto tokens, the nine keys collapsed to four DUPLICATES in a JS object
// literal, so the last one silently won. Every primary-accented slide
// was resolving to '292 85% 62%' — the leftover magenta — which is why
// the pagination dots rendered bright pink on an orange-brand app.
export const ICON_BG_TO_HSL = {
  'bg-primary/20':     'var(--primary)',
  'bg-success/20':     'var(--success)',
  'bg-info/20':        'var(--info)',
  'bg-destructive/20': 'var(--destructive)',
};

/** A slide's accent: explicit `color` wins, then its icon chip, then brand. */
export function heroSlideAccent(slide) {
  if (!slide) return 'var(--primary)';
  return slide.color || ICON_BG_TO_HSL[slide.iconBg] || 'var(--primary)';
}
