// src/components/capsules/openFx.jsx
//
// The stage effects behind a capsule open: the sunburst that turns behind
// the canister and the reveal plate, the shock rings and spark streaks when
// something hits, a short camera shake and a flash. All of it scales with
// the RARITY of what came out, so a common lands cleanly and a legendary
// shakes the screen.
//
// What this is deliberately not: glow blobs, blur, gradients or confetti.
// Every mark is a flat shape (a wedge, a stroked circle, a 2px line) and
// every animation moves only transform and opacity, so the stage composites
// on the GPU and holds frame rate on an iPhone SE.
//
// Presentation only. The server has already decided and granted the item
// before any of this runs; nothing here reads or writes a capsule.
//
// Reduced motion turns every one of these off. The sunburst still draws
// (static) because it carries the rarity colour, which is information.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { prefersReducedMotion } from '@/lib/reducedMotion';

const BONE = '#F5F2F0';

// ─── How big each rarity's moment is ──────────────────────────────────────────
// rays    sunburst opacity behind the reveal (0 = none)
// rings   shock rings when the plate hits
// sparks  spark streaks when the plate hits
// shake   camera shake, px
// flash   full-screen flash opacity
// sheen   a foil glint sweeps across the sticker
// hot     the canister runs the long charge and leaks its colour at the
//         seam before it pops: the pull announces itself early
// hold    ms between the plate hitting and the name stamping in
// charge  ms the canister rattles before it pops, single open
export const DRAMA = {
  common:    { rays: 0.035, rings: 1, sparks: 8,  shake: 0, flash: 0,    sheen: false, hot: false, hold: 180, charge: 1200 },
  uncommon:  { rays: 0.05,  rings: 1, sparks: 10, shake: 2, flash: 0,    sheen: false, hot: false, hold: 220, charge: 1200 },
  rare:      { rays: 0.08,  rings: 2, sparks: 14, shake: 4, flash: 0.1,  sheen: true,  hot: false, hold: 320, charge: 1200 },
  epic:      { rays: 0.11,  rings: 2, sparks: 18, shake: 6, flash: 0.16, sheen: true,  hot: true,  hold: 480, charge: 2000 },
  legendary: { rays: 0.15,  rings: 3, sparks: 24, shake: 9, flash: 0.26, sheen: true,  hot: true,  hold: 700, charge: 2200 },
  mythic:    { rays: 0.15,  rings: 3, sparks: 26, shake: 10, flash: 0.28, sheen: true, hot: true,  hold: 700, charge: 2200 },
  animated:  { rays: 0.15,  rings: 3, sparks: 26, shake: 10, flash: 0.28, sheen: true, hot: true,  hold: 700, charge: 2200 },
};

// ─── Beats for the hands-on opens (CrackStage, FlipStage) ─────────────────────
// ms. `decide` is the swell between a tap and its answer, the moment of
// truth on every strike; it is short enough that mashing feels like
// mashing. `auto` strikes for someone who only watches. A batch runs the
// same beats tighter, one capsule after another.
export const OPEN_TIMING = {
  single: { decide: 220, climb: 380, fizzle: 460, afterPop: 480, firstAuto: 1800, auto: 1300, rise: 640, flip: 200 },
  batch:  { decide: 150, climb: 260, fizzle: 300, afterPop: 240, firstAuto: 700,  auto: 550,  rise: 420, flip: 160 },
};

/** The drama table row for a rarity, falling back to common. */
export function dramaFor(rarity) {
  return DRAMA[rarity] ?? DRAMA.common;
}

/**
 * How long the canister rattles before it pops. A batch runs one charge per
 * capsule, so each is shorter; reduced motion skips it entirely.
 */
export function chargeMs(rarity, { batch = false, reduced = false } = {}) {
  if (reduced) return 0;
  const base = dramaFor(rarity).charge;
  return batch ? Math.round(base * 0.45) : base;
}

// ─── The sunburst ─────────────────────────────────────────────────────────────
// Wedges from a centre point, drawn once and turned slowly with a CSS
// animation on the whole layer. Sized in vmax so it always overfills the
// screen and never shows an edge.
function wedges(n, widthDeg) {
  const out = [];
  const r = 150;
  for (let i = 0; i < n; i++) {
    const a0 = ((i * 360) / n - widthDeg / 2) * (Math.PI / 180);
    const a1 = ((i * 360) / n + widthDeg / 2) * (Math.PI / 180);
    out.push(`M0 0L${(Math.cos(a0) * r).toFixed(2)} ${(Math.sin(a0) * r).toFixed(2)}L${(Math.cos(a1) * r).toFixed(2)} ${(Math.sin(a1) * r).toFixed(2)}Z`);
  }
  return out.join('');
}
const RAYS_MAIN = wedges(16, 11);
const RAYS_BACK = wedges(10, 5);

/**
 * The stage layer: a fixed, full-screen, pointer-transparent layer behind
 * the opener's content. `anchor` is an element whose centre the burst and
 * the rays sit on; it is re-measured whenever `anchorKey` changes.
 */
export function useOpenerFx() {
  const layerRef = useRef(null);
  const sparkRef = useRef(null);
  const raysRef = useRef(null);
  const shakeRef = useRef(null);
  const reduced = useMemo(() => prefersReducedMotion(), []);

  /** Move the rays' centre onto an element (or a point inside it). */
  const aimAt = useCallback((el, fy = 0.5) => {
    const layer = layerRef.current;
    if (!layer || !el?.getBoundingClientRect) return null;
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height * fy;
    layer.style.setProperty('--fx-x', `${x}px`);
    layer.style.setProperty('--fx-y', `${y}px`);
    return { x, y };
  }, []);

  /** Colour and strength of the sunburst. `double` adds the back layer. */
  const setRays = useCallback((color, opacity, { double = false, fast = false } = {}) => {
    const rays = raysRef.current;
    if (!rays) return;
    rays.style.color = color || BONE;
    rays.style.opacity = String(opacity || 0);
    rays.dataset.double = double ? '1' : '0';
    rays.dataset.fast = fast ? '1' : '0';
  }, []);

  /** Shock rings and spark streaks from a point, plus shake and flash. */
  const burst = useCallback((point, rarity, { scale = 1, shake = true } = {}) => {
    const host = sparkRef.current;
    if (!host || !point || reduced) return;
    if (typeof host.animate !== 'function') return;
    const d = dramaFor(rarity);
    const color = rarityTint(rarity).color;
    const make = (css) => {
      const n = document.createElement('div');
      Object.assign(n.style, { position: 'absolute', left: `${point.x}px`, top: `${point.y}px`, pointerEvents: 'none', ...css });
      host.appendChild(n);
      return n;
    };
    const finish = (n, anim) => { anim.onfinish = () => n.remove(); anim.oncancel = () => n.remove(); };

    // Rings: a large thin circle scaled up from nothing, so the stroke
    // thickens as it spreads, the way a pressure wave reads.
    const rings = Math.max(1, Math.round(d.rings * scale));
    for (let i = 0; i < rings; i++) {
      const size = 300 + i * 90;
      const n = make({
        width: `${size}px`, height: `${size}px`, marginLeft: `${-size / 2}px`, marginTop: `${-size / 2}px`,
        borderRadius: '9999px', border: `${i === 0 ? 3 : 2}px solid ${i === 0 ? color : BONE}`, opacity: '0',
      });
      finish(n, n.animate(
        [{ transform: 'scale(0.08)', opacity: 0.95 }, { transform: 'scale(1)', opacity: 0 }],
        { duration: 620 + i * 140, delay: i * 90, easing: 'cubic-bezier(0.1, 0.7, 0.3, 1)', fill: 'both' },
      ));
    }

    // Sparks: short 2px streaks thrown outward at even angles with a
    // little jitter, half in the rarity colour, half bone.
    const count = Math.round(d.sparks * scale);
    for (let i = 0; i < count; i++) {
      const angle = (360 / count) * i + (Math.random() * 14 - 7);
      const len = 10 + Math.random() * 18;
      const from = 26 + Math.random() * 14;
      const to = from + 70 + Math.random() * 90 * Math.max(scale, 0.6);
      const n = make({
        width: '2px', height: `${len}px`, marginLeft: '-1px', borderRadius: '2px',
        background: i % 2 ? BONE : color, transformOrigin: '50% 0',
      });
      finish(n, n.animate(
        [
          { transform: `rotate(${angle}deg) translateY(${from}px) scaleY(1)`, opacity: 1 },
          { transform: `rotate(${angle}deg) translateY(${to}px) scaleY(0.15)`, opacity: 0 },
        ],
        { duration: 420 + Math.random() * 260, easing: 'cubic-bezier(0.05, 0.8, 0.3, 1)', fill: 'both' },
      ));
    }

    // Flash: the whole stage lifts toward the rarity colour for a blink.
    if (d.flash > 0 && scale >= 1) {
      const n = make({ left: '0', top: '0', width: '100%', height: '100%', position: 'absolute', background: color, opacity: '0' });
      finish(n, n.animate(
        [{ opacity: 0 }, { opacity: d.flash, offset: 0.18 }, { opacity: 0 }],
        { duration: 360, easing: 'ease-out', fill: 'both' },
      ));
    }

    // Shake: a few decaying offsets on the content, not the stage, so the
    // rays hold still and the hit reads as the camera taking it.
    const target = shakeRef.current;
    const amp = d.shake * scale;
    if (shake && target && amp > 0 && typeof target.animate === 'function') {
      const frames = [];
      for (let i = 0; i <= 6; i++) {
        const k = amp * (1 - i / 6);
        const dx = i === 6 ? 0 : (i % 2 ? -1 : 1) * k;
        const dy = i === 6 ? 0 : (Math.random() * 2 - 1) * k * 0.6;
        frames.push({ transform: `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)` });
      }
      target.animate(frames, { duration: 360, easing: 'linear' });
    }
  }, [reduced]);

  return { layerRef, sparkRef, raysRef, shakeRef, aimAt, setRays, burst, reduced };
}

/** The layer itself. Render once, first child of the opener. */
export function OpenerStage({ fx }) {
  // Park the centre somewhere sensible before the first measurement.
  useEffect(() => {
    const layer = fx.layerRef.current;
    if (!layer) return;
    if (!layer.style.getPropertyValue('--fx-x')) {
      layer.style.setProperty('--fx-x', '50vw');
      layer.style.setProperty('--fx-y', '35vh');
    }
  }, [fx.layerRef]);

  return (
    <div ref={fx.layerRef} className="opener-stage fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div ref={fx.raysRef} className="opener-rays" style={{ opacity: 0 }} data-double="0" data-fast="0">
        <svg className="opener-rays-back" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice">
          <path d={RAYS_BACK} fill="currentColor" />
        </svg>
        <svg className="opener-rays-main" viewBox="-100 -100 200 200" preserveAspectRatio="xMidYMid slice">
          <path d={RAYS_MAIN} fill="currentColor" />
        </svg>
      </div>
      <div ref={fx.sparkRef} className="absolute inset-0" />
    </div>
  );
}
