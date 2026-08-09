// src/lib/heroChrome.js
//
// The hero carousel's shared CHROME — the gradient maths, the watermark
// geometry and the accent lookup that the Dashboard hero, the Progress
// stat carousel and the Nutrition shortcuts carousel all paint with.
//
// All of this lived privately inside Dashboard.jsx / HeroSlideshow.jsx while
// Progress and Nutrition carried a second, older treatment (two blurred
// radial blobs, one of them animating forever). Two carousels that are meant
// to read as the same object cannot be kept in step by copying values
// between three files — they had already drifted on the watermark size, the
// kicker's tracking and the chevron's fill. One module, three importers.
//
// The engine that moves the slides is HeroPager (src/components/HeroPager.jsx).
// This file is only what the band PAINTS; it holds no state and no JSX so it
// can be imported from a page, a component or a test without dragging React
// in.

/* Hero tint falloff.
 *
 * A two-stop `linear-gradient(A 0%, transparent 55%)` still shows a faint
 * line, and the reason is not the colour — it is the SLOPE. Alpha falls at
 * a constant rate and then stops falling, instantly, at the final stop.
 * The value is continuous there but its derivative is not, and human
 * vision exaggerates exactly that discontinuity (Mach banding: lateral
 * inhibition in the retina amplifies second-order edges). So the harder
 * you look at a "smooth" linear scrim, the more clearly you see the line
 * where it ends — which is what got reported here.
 *
 * Smoothstep (3t² − 2t³) has zero derivative at BOTH ends. The tint eases
 * out from under the identity rule and eases into nothing at the bottom,
 * with no point anywhere in the band where the rate of change jumps. That
 * is a property of the curve, not a tuning of the numbers.
 *
 * The ramp also runs the FULL height now rather than stopping at 55%.
 * Terminating early puts the curve's end inside the band; ending at 100%
 * puts it exactly on the band's own boundary, where a card edge is
 * expected anyway. Alpha is ~0.004 by 90%, so it is visually gone well
 * before then regardless.
 *
 * The stop COUNT matters for the same reason the curve does. Browsers
 * interpolate linearly between stops, so the curve ships as a polyline and
 * every junction is itself a small slope change — the defect this is meant
 * to remove, reintroduced N times if the stops are too far apart. At 10%
 * spacing the steepest segment moves 0.021 alpha; at 5% it moves 0.011 —
 * about 0.0005 per pixel down a 429px band, and only 0.001 per segment at
 * the two ends, which is the zero-derivative property doing its job.
 * Measured, not guessed.
 */
const HERO_TINT_PEAK = 0.14;
const HERO_TINT_STEPS = 20;

/**
 * Smoothstep alpha stops from 0→100%.
 * `rising: false` (default) falls peak→0; `rising: true` climbs 0→peak.
 */
export function smoothstepStops(peak, { rising = false } = {}) {
  return Array.from({ length: HERO_TINT_STEPS + 1 }, (_, i) => {
    const t = i / HERO_TINT_STEPS;
    const smoothstep = t * t * (3 - 2 * t);
    return {
      pct: +(t * 100).toFixed(1),
      alpha: +(peak * (rising ? smoothstep : 1 - smoothstep)).toFixed(4),
    };
  });
}

const HERO_TINT_STOPS = smoothstepStops(HERO_TINT_PEAK);

/* Band-to-page fade.
 *
 * The band's surface is --card on dark / --muted on light, and the page is
 * --background. That is a step of 7.65 luminance IN ONE PIXEL across the
 * full width — measured, and roughly 250× sharper per pixel than anything
 * the tint above does (~0.03/px). It is the card boundary, and it was the
 * edge left over once the tint stopped being the problem.
 *
 * This scrim paints --background at RISING alpha, reaching a solid 1.0
 * exactly at the band's bottom edge. So the boundary becomes page colour
 * meeting page colour, which cannot render a line no matter the contrast.
 * Painting the page colour rather than fading the band's own alpha is what
 * makes it theme-agnostic: --background is themed, so one gradient covers
 * light and dark without a `dark:` variant, which an inline style could not
 * express anyway.
 *
 * Smoothstep again, and here the zero derivative at the START is the load-
 * bearing half: a linear scrim would begin absorbing colour at a constant
 * rate from its first pixel, putting a fresh slope discontinuity at the top
 * of the scrim — trading the edge at the band's bottom for one 30% higher
 * up. Easing in means the scrim is imperceptible where it begins.
 *
 * Consequence worth stating: the hero stops being a card. It has no bottom
 * edge and its rounded corners no longer read, because the surface dissolves
 * instead of stopping. `rounded-b-2xl` stays on the band only because it
 * still clips the tint; it is no longer doing visible work.
 *
 * This one is for the BLEEDING band only. A hero that stays inside the
 * page's inset (Progress, Nutrition) keeps its hairline border and must not
 * dissolve — there is a card edge there on purpose.
 */
const HERO_FADE_STOPS = smoothstepStops(1, { rising: true });

/** Build a top-to-bottom gradient from stops, for an `H S% L%` triplet or a var(). */
export function stopsToGradient(color, stops) {
  const parts = stops.map(({ pct, alpha }) => `hsl(${color} / ${alpha}) ${pct}%`);
  return `linear-gradient(to bottom, ${parts.join(', ')})`;
}

/** The hero's accent falloff, keyed to the current slide's colour. */
export function heroTintGradient(color) {
  return stopsToGradient(color, HERO_TINT_STOPS);
}

/** The band dissolving into the page. Themed via --background, so one
 *  value is correct in both light and dark. */
export const HERO_FADE_GRADIENT = stopsToGradient('var(--background)', HERO_FADE_STOPS);

/* Chevron clearance, applied to each slide ROOT rather than to the padded
 * container that holds the pager.
 *
 * That container is the ancestor of the pager's `overflow-hidden` track, so
 * padding there narrows the PAGE — and the watermark, positioned at its
 * slide's right edge, was clipped 48px short of the band while sitting 16px
 * from the top. Asymmetric corner.
 *
 * Here it insets the text and leaves the icon where it is: an absolutely
 * positioned child resolves `right: 0` against its containing block's
 * PADDING box, so padding on the root does not move it.
 *
 * Only when there is more than one slide, because that is the only time the
 * next-slide chevron renders — with one slide the gutter would reserve empty
 * space for a control that is not there.
 */
export const HERO_SLIDE_GUTTER = 'pe-12 md:pe-14';

/* The slide watermark — the big translucent icon in the top-right corner.
 *
 * One object, used by every slide branch on every page. It was three copies
 * of the same literal inside HeroSlideshow, which is how they drifted to two
 * different opacities — and then Progress and Nutrition added a fourth and a
 * fifth at 96px and 100px, offset inward, in the slide's own accent.
 *
 * 72px and pinned hard to the corner. At 110px, offset 8px in and 5px down,
 * the icon reached a third of the way across a 311px page and ~115px down
 * from the top — straight through the title and sub of any slide whose copy
 * runs long. Shrinking alone would not have cleared it, because the offsets
 * pushed the box further into the text column; smaller AND cornered is what
 * does.
 *
 * `absolute` means it contributes nothing to layout, so text flows underneath
 * it — nothing here prevents an overlap by itself. The clearance IS the
 * geometry, so it is verified by measuring this rect against every text rect
 * on every slide at both 375 and 430pt rather than by eye.
 */
export const HERO_WATERMARK_PX = 72;
export const heroWatermarkStyle = (opacity = 0.11) => ({
  width: HERO_WATERMARK_PX,
  height: HERO_WATERMARK_PX,
  opacity,
  color: 'white',
  right: 0,
  top: 0,
  transform: 'none',
});

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
