// src/components/capsules/openFx.jsx
//
// The stage behind a capsule open: a field of moving colour behind the
// canister and the reveal plate, the shock rings and spark streaks when
// something hits, a short camera shake and a flash. All of it scales with
// the RARITY of what came out, so a common lands cleanly and a legendary
// shakes the screen.
//
// The colour field is LeagueFluid, the same paint the rank up runs behind
// its crest (Kegan, 2026-10-02: "a fluid background of colors to replace
// the starburst", "and the fluid colors move with each crack"). Every
// strike stirs it, every climb pours the new rarity's colour in from the
// canister, and the pop churns it hardest. It replaced a turning sunburst.
//
// The rings and sparks are flat shapes (a stroked circle, a 2px line) that
// move only transform and opacity. The field is one WebGL draw at half
// resolution, so the stage holds frame rate on an iPhone SE.
//
// Presentation only. The server has already decided and granted the item
// before any of this runs; nothing here reads or writes a capsule.
//
// Reduced motion turns the hits off and holds the field still. It still
// draws, in the rarity's colour, because the colour is information.

import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { rarityTint } from '@/components/loot/RarityVisuals';
import { prefersReducedMotion } from '@/lib/reducedMotion';
import LeagueFluid from '@/components/leagues/LeagueFluid';

const BONE = '#F5F2F0';

// ─── How big each rarity's moment is ──────────────────────────────────────────
// paint   how loud the colour field runs once this rarity is reached, 0 to 1
// stir    how hard reaching it churns the field, 0 to 1
// rings   shock rings when the plate hits
// sparks  spark streaks when the plate hits
// shake   camera shake, px
// flash   full-screen flash opacity
// sheen   a foil glint sweeps across the sticker
// hold    ms between the plate hitting and the name stamping in
export const DRAMA = {
  common:    { paint: 0.42, stir: 0.3,  rings: 1, sparks: 8,  shake: 0,  flash: 0,    sheen: false, hold: 180 },
  uncommon:  { paint: 0.55,  stir: 0.45, rings: 1, sparks: 10, shake: 2,  flash: 0,    sheen: false, hold: 220 },
  rare:      { paint: 0.68, stir: 0.6,  rings: 2, sparks: 14, shake: 4,  flash: 0.1,  sheen: true,  hold: 320 },
  epic:      { paint: 0.78, stir: 0.8,  rings: 2, sparks: 18, shake: 6,  flash: 0.16, sheen: true,  hold: 480 },
  legendary: { paint: 0.85,    stir: 1,    rings: 3, sparks: 24, shake: 9,  flash: 0.26, sheen: true,  hold: 700 },
  mythic:    { paint: 0.85,    stir: 1,    rings: 3, sparks: 26, shake: 10, flash: 0.28, sheen: true,  hold: 700 },
  animated:  { paint: 0.85,    stir: 1,    rings: 3, sparks: 26, shake: 10, flash: 0.28, sheen: true,  hold: 700 },
};

// ─── Beats for the crack ──────────────────────────────────────────────────────
// ms. `decide` is the swell between a tap and its answer, the moment of
// truth on every strike; it is short enough that mashing feels like
// mashing. `auto` strikes for someone who only watches. A batch runs the
// same beats tighter, one capsule after another.
export const OPEN_TIMING = {
  single: { decide: 220, climb: 380, afterPop: 480, firstAuto: 1800, auto: 1300 },
  batch:  { decide: 150, climb: 260, afterPop: 240, firstAuto: 700,  auto: 550 },
};

/** The drama table row for a rarity, falling back to common. */
export function dramaFor(rarity) {
  return DRAMA[rarity] ?? DRAMA.common;
}

// ─── The colour field ─────────────────────────────────────────────────────────
// What the field is doing lives in a tiny store outside React, so a stir on
// every tap re-renders only the field and never the opener or its stages
// (whose effects depend on `fx` keeping its identity).
//
// colour  the rarity colour it pours toward (it walks colour to colour)
// mood    LeagueFluid's phase: 'enter' calm, 'landed' swirling, 'break' a churn
// paint   how loud it runs, 0 to 1
// pulse   a counter; each bump stirs it once, `pulseSize` hard
function createField(colour) {
  let state = { colour, mood: 'enter', paint: DRAMA.common.paint, pulse: 0, pulseSize: 0 };
  const subs = new Set();
  const set = (patch) => {
    state = { ...state, ...patch };
    subs.forEach((fn) => fn());
  };
  return {
    get: () => state,
    subscribe: (fn) => { subs.add(fn); return () => subs.delete(fn); },
    set,
    stir: (size) => set({ pulse: state.pulse + 1, pulseSize: size }),
  };
}

/**
 * The stage: a fixed, full-screen, pointer-transparent layer behind the
 * opener's content, with the colour field, and the hits thrown from a point.
 */
export function useOpenerFx() {
  const layerRef = useRef(null);
  const sparkRef = useRef(null);
  const shakeRef = useRef(null);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const field = useMemo(() => createField(rarityTint('common').color), []);

  /** Where the next hit lands: the centre of an element, or a point in it. */
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

  /**
   * Set the field. `rarity` picks the colour and how loud it runs; `mood`
   * is 'enter' (calm), 'landed' (swirling) or 'break' (the pop's churn);
   * `stir` kicks it once, 0 to 1. Anything left out stays as it is.
   */
  const paint = useCallback(({ rarity, mood, stir } = {}) => {
    const patch = {};
    if (rarity) {
      patch.colour = rarityTint(rarity).color;
      patch.paint = dramaFor(rarity).paint;
    }
    if (mood) patch.mood = mood;
    if (Object.keys(patch).length) field.set(patch);
    if (stir) field.stir(stir);
  }, [field]);

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
    // field holds still and the hit reads as the camera taking it.
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

  return { layerRef, sparkRef, shakeRef, field, aimAt, paint, burst, reduced };
}

// The field opens in Common's colour on every open, and walks from there.
// LeagueFluid centres on a point a little above the middle of the screen,
// which is where the canister and the reveal plate sit, so it needs no
// anchor here.
const START = rarityTint('common').color;


function Field({ fx }) {
  const s = useSyncExternalStore(fx.field.subscribe, fx.field.get, fx.field.get);
  // Held still, the field draws one frame, so a new colour is a new frame.
  return (
    <LeagueFluid
      key={fx.reduced ? s.colour : 'live'}
      from={fx.reduced ? s.colour : START}
      to={s.colour}
      phase={s.mood}
      chargeMs={1}
      still={fx.reduced}
      pulse={s.pulse}
      pulseSize={s.pulseSize}
      strength={s.paint}
      cartoon
    />
  );
}

/** The layer itself. Render once, first child of the opener. */
export function OpenerStage({ fx }) {
  // Park the hit point somewhere sensible before the first measurement.
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
      <Field fx={fx} />
      <div ref={fx.sparkRef} className="absolute inset-0" />
    </div>
  );
}
