// src/components/ThemeAnimationLayer.jsx
//
// Renders fullscreen animated scenes for loot themes. Each theme's
// `animation` id (set in src/lib/lootThemes.js) maps to a scene Layer
// component below. Layers sit pointer-events-none at z-index -1, behind
// every UI element. (Hotfix after Wave 65 ship: at z-index 0 a fixed-
// positioned descendant paints AFTER static-positioned siblings in the
// same stacking context — so the scene was covering the cards on
// common themes whose scenes are opaque pink/teal/etc. -1 places the
// scene between the body's background and the static content, where
// it actually belongs.)
//
// Rarity dictates motion budget:
//   • common    — fully static scene
//   • uncommon  — static scene + one light animated element
//   • rare      — static scene + multiple animated layers
//   • epic      — full atmospheric animation (parallax, rotation, etc.)
//   • legendary — animation that transforms the chrome itself
//
// All CSS classes + @keyframes live in src/index.css under the
// "Wave 65 — Loot Theme Scenes" section. The mount wrapper
// `.theme-scene` is what the `prefers-reduced-motion` rule keys off.
//
// Performance note: previous version used Framer Motion for every
// particle which produced 100+ animating DOM nodes through JS. The
// CSS-keyframe approach lets the compositor handle it — measurably
// smoother on mid-range Android.

import { useMemo, useEffect, useRef, Fragment } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from '@/lib/ThemeContext';

// ─── Helpers ─────────────────────────────────────────────────────────────
const rand = (min, max) => Math.random() * (max - min) + min;

// ════════════════════════════════════════════════════════════════════════
// COMMON — static scenes (or near-static)
// ════════════════════════════════════════════════════════════════════════

// ─── Mint Frost — layered pine forest at horizon + drifting mist
// Wave 70: replaced single clip-path "spike" silhouette with real
// layered conifer trees (two depth rows on a hill).
function MintFrostLayer() {
  const backRow = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    x: i * 6.5 + rand(-1, 1),
    w: rand(38, 56), h: rand(80, 110),
    fill: `hsl(152, 45%, ${rand(15, 20)}%)`,
    base: '18%',
  })), []);
  const frontRow = useMemo(() => Array.from({ length: 11 }, (_, i) => ({
    x: i * 9.5 + rand(-2, 2),
    w: rand(60, 92), h: rand(130, 180),
    fill: `hsl(152, 52%, ${rand(9, 14)}%)`,
    base: '13%',
  })), []);
  return (
    <>
      <div className="mint-bg" />
      <div className="mint-hill" />
      {backRow.map((t, i) => (
        <div key={`b${i}`} className="pine"
          style={{ left: `${t.x}%`, width: t.w, height: t.h, '--fill': t.fill, '--base': t.base }}
        />
      ))}
      {frontRow.map((t, i) => (
        <div key={`f${i}`} className="pine"
          style={{ left: `${t.x}%`, width: t.w, height: t.h, '--fill': t.fill, '--base': t.base }}
        />
      ))}
      <div className="mint-mist a" />
      <div className="mint-mist b" />
    </>
  );
}

// ─── Solar Flare (common, NEW in Wave 70) — blazing sun + corona +
// 16 dancing rays + heat haze. The disc breathes, the corona spins.
function SolarFlareLayer() {
  const rays = useMemo(() => Array.from({ length: 16 }, (_, i) => ({
    rot: i * (360 / 16),
    rh: rand(220, 360),
    rw: rand(5, 10),
    sway: rand(4, 10) * (i % 2 === 0 ? 1 : -1),
    dur: rand(3, 5.5),
    delay: rand(0, 3),
  })), []);
  return (
    <>
      <div className="solar-sky" />
      {rays.map((r, i) => (
        <div key={i} className="solar-ray"
          style={{
            '--rot': `${r.rot}deg`, '--rh': `${r.rh}px`, '--rw': `${r.rw}px`,
            '--sway': `${r.sway}deg`, '--dur': `${r.dur}s`, '--delay': `${r.delay}s`,
          }}
        />
      ))}
      <div className="solar-corona" />
      <div className="solar-flare-arc" />
      <div className="solar-disc" />
      <div className="solar-haze" />
    </>
  );
}

// ─── Jade Stone (common, NEW in Wave 70) — bamboo grove at dusk +
// swaying leaves + drifting mist + blinking fireflies + falling leaves.
function JadeStoneLayer() {
  const stalks = useMemo(() => [
    { x: 6,  w: 16, seg: 100, op: 0.9  },
    { x: 14, w: 11, seg: 80,  op: 0.7  },
    { x: 23, w: 20, seg: 120, op: 0.95 },
    { x: 34, w: 12, seg: 85,  op: 0.75 },
    { x: 44, w: 18, seg: 110, op: 0.9  },
    { x: 55, w: 10, seg: 75,  op: 0.65 },
    { x: 64, w: 22, seg: 130, op: 0.95 },
    { x: 75, w: 13, seg: 90,  op: 0.8  },
    { x: 85, w: 16, seg: 100, op: 0.88 },
    { x: 93, w: 11, seg: 80,  op: 0.7  },
  ], []);
  const leaves = useMemo(() => Array.from({ length: 14 }, () => ({
    x: rand(5, 95), y: rand(8, 60),
    rot: rand(-30, 30),
    dur: rand(4, 7), delay: rand(0, 4),
    flip: Math.random() > 0.5 ? -1 : 1,
  })), []);
  const fireflies = useMemo(() => Array.from({ length: 14 }, () => ({
    x: rand(5, 95), y: rand(40, 90),
    dx: rand(-30, 30), dy: rand(-30, 10),
    dur: rand(5, 9), delay: rand(0, 6),
  })), []);
  const fallingLeaves = useMemo(() => Array.from({ length: 18 }, () => ({
    x: rand(0, 100),
    dur: rand(11, 20),
    delay: rand(0, 16),
    dx: rand(-90, 90),
    hue: rand(135, 155),
    light: rand(32, 46),
  })), []);
  return (
    <>
      <div className="jade-bg" />
      {stalks.map((s, i) => (
        <div key={i} className="bamboo"
          style={{
            left: `${s.x}%`,
            '--w': `${s.w}px`, '--seg': `${s.seg}px`, '--op': s.op,
          }}
        />
      ))}
      {leaves.map((l, i) => (
        <div key={i} className="bamboo-leaf"
          style={{
            left: `${l.x}%`, top: `${l.y}%`,
            transform: `scaleX(${l.flip})`,
            '--rot': `${l.rot}deg`,
            '--dur': `${l.dur}s`, '--delay': `${l.delay}s`,
          }}
        />
      ))}
      <div className="jade-mist" />
      {fallingLeaves.map((l, i) => (
        <div key={`fl${i}`} className="jade-leaf-fall"
          style={{
            left: `${l.x}%`,
            background: `hsl(${l.hue}, 55%, ${l.light}%)`,
            '--dur': `${l.dur}s`, '--delay': `${l.delay}s`, '--dx': `${l.dx}px`,
          }}
        />
      ))}
      {fireflies.map((f, i) => (
        <div key={i} className="firefly"
          style={{
            left: `${f.x}%`, top: `${f.y}%`,
            '--dx': `${f.dx}px`, '--dy': `${f.dy}px`,
            '--dur': `${f.dur}s`, '--delay': `${f.delay}s`,
          }}
        />
      ))}
    </>
  );
}

// ─── Coral Rush — underwater coral garden + caustics + bubbles ──────────
function CoralRushLayer() {
  const corals = useMemo(() => [
    { type: 'fan',    x: 8,  hue: 0,    h: 90 },
    { type: 'finger', x: 15, hue: 350,  h: 70 },
    { type: 'finger', x: 17, hue: 0,    h: 55 },
    { type: 'dome',   x: 25, hue: 12,   h: 38 },
    { type: 'fan',    x: 36, hue: 340,  h: 70 },
    { type: 'finger', x: 44, hue: 0,    h: 80 },
    { type: 'finger', x: 46, hue: 12,   h: 60 },
    { type: 'dome',   x: 55, hue: 0,    h: 45 },
    { type: 'fan',    x: 65, hue: 350,  h: 85 },
    { type: 'finger', x: 74, hue: 8,    h: 65 },
    { type: 'finger', x: 76, hue: 0,    h: 50 },
    { type: 'dome',   x: 85, hue: 340,  h: 42 },
    { type: 'fan',    x: 92, hue: 0,    h: 75 },
  ], []);
  const bubbles = useMemo(() => Array.from({ length: 14 }, () => ({
    x: rand(5, 95),
    size: rand(4, 12),
    dur: rand(8, 16),
    delay: rand(0, 12),
    dx: rand(-30, 30),
  })), []);
  return (
    <>
      <div className="coral-water" />
      <div className="caustic" />
      {corals.map((c, i) => (
        <div key={i} className={`coral-shape ${c.type}`}
          style={{
            left: `${c.x}%`,
            height: c.h,
            '--coral-hue': c.hue,
          }}
        />
      ))}
      {bubbles.map((b, i) => (
        <div key={i} className="bubble"
          style={{
            left: `${b.x}%`, bottom: '5%',
            width: b.size, height: b.size,
            '--dur': `${b.dur}s`, '--delay': `${b.delay}s`,
            '--dx': `${b.dx}px`,
          }}
        />
      ))}
    </>
  );
}

// ─── Rose Quartz — central cherry tree canopy + branch lines + petals
// Wave 69: redesigned from two corner branches to a big central blossom
// canopy with branch lines descending and more petals falling.
function RoseQuartzLayer() {
  const petals = useMemo(() => Array.from({ length: 32 }, () => ({
    x: rand(0, 100),
    dur: rand(12, 22),
    delay: rand(0, 15),
    dx: rand(-80, 80),
  })), []);
  return (
    <>
      <div className="rose-bg" />
      <div className="rose-branch-line l" />
      <div className="rose-branch-line r" />
      <div className="rose-branch-line main" />
      <div className="rose-canopy" />
      {petals.map((p, i) => (
        <div key={i} className="rose-petal-fall"
          style={{
            left: `${p.x}%`,
            '--dur': `${p.dur}s`, '--delay': `${p.delay}s`,
            '--dx': `${p.dx}px`,
          }}
        />
      ))}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// UNCOMMON — scene + light animation
// ════════════════════════════════════════════════════════════════════════

// ─── Dusk Protocol — desert sundown (Wave 69 redesign)
// Layered dunes + huge sun on horizon + lens flare line + drifting dust
// on the wind. Sky slowly cycles amber → magenta.
function DuskLayer() {
  return (
    <>
      <div className="dusk-sky" />
      <div className="dusk-dust a" />
      <div className="dusk-dust b" />
      <div className="dusk-sun" />
      <div className="dusk-flare" />
      <div className="dusk-dunes-far" />
      <div className="dusk-dunes-near" />
    </>
  );
}

// ─── Tidal Force — beach + waves + gulls + Wave 70 props
// (palm trees, sandcastle w/ flag, bucket, shovel, scuttling crab,
// periodic big breaking wave). Existing sky/ocean/sand/foam stays.
function TidalLayer() {
  const crests = useMemo(() => Array.from({ length: 6 }, (_, i) => ({
    top: 42 + i * 4.5,
    dur: rand(8, 14),
    delay: i * 1.8,
    width: rand(40, 90),
  })), []);
  const gulls = useMemo(() => Array.from({ length: 3 }, (_, i) => ({
    top: 12 + i * 8,
    dur: rand(20, 32),
    delay: i * 8,
  })), []);
  return (
    <>
      <div className="beach-sky" />
      <div className="ocean-water" />
      <div className="ocean-horizon-line" />
      <div className="beach-sand" />
      <div className="shore-foam" />
      <div className="shore-foam b" />
      {crests.map((c, i) => (
        <div key={i} className="wave-crest"
          style={{
            top: `${c.top}%`,
            width: `${c.width}%`,
            '--dur': `${c.dur}s`, '--delay': `${c.delay}s`,
          }}
        />
      ))}
      {gulls.map((g, i) => (
        <div key={i} className="gull"
          style={{
            top: `${g.top}%`,
            '--dur': `${g.dur}s`, '--delay': `${g.delay}s`,
          }}
        />
      ))}
      <div className="big-wave" />

      {/* Palm trees flanking the beach */}
      <Palm left="6%"  base="20%" ph={150} dur={5.5} delay={0} />
      <Palm left="88%" base="22%" ph={120} dur={6.2} delay={1.2} />

      {/* Sandcastle with flag */}
      <div className="sandcastle" style={{ left: '40%' }}>
        <div className="castle-tower l" />
        <div className="castle-tower r" />
        <div className="castle-body" />
        <div className="castle-tower m">
          <div className="castle-flag" />
        </div>
      </div>

      {/* Bucket + shovel beside the castle */}
      <div className="bucket" style={{ left: '54%' }} />
      <div className="shovel" style={{ left: '60%' }}>
        <div className="shovel-handle" />
        <div className="shovel-scoop" />
      </div>

      {/* A crab scuttling along the sand */}
      <div className="crab" style={{ '--dur': '24s', '--delay': '2s' }}>
        <div className="crab-claw l" />
        <div className="crab-claw r" />
        <div className="crab-leg" style={{ left:  '4px' }} />
        <div className="crab-leg" style={{ left: '10px' }} />
        <div className="crab-leg" style={{ right:'10px' }} />
        <div className="crab-leg" style={{ right: '4px' }} />
        <div className="crab-body">
          <div className="crab-eye l" />
          <div className="crab-eye r" />
        </div>
      </div>
    </>
  );
}

// Reusable palm tree (trunk + 6 radiating fronds + 2 coconuts).
function Palm({ left, base, ph, dur, delay }) {
  return (
    <div className="palm"
      style={{ left, '--base': base, '--ph': `${ph}px`, '--dur': `${dur}s`, '--delay': `${delay}s` }}
    >
      <div className="palm-trunk" />
      <div className="palm-frond f1" />
      <div className="palm-frond f2" />
      <div className="palm-frond f3" />
      <div className="palm-frond f4" />
      <div className="palm-frond f5" />
      <div className="palm-frond f6" />
      <div className="coconut" style={{ marginLeft: '-5px' }} />
      <div className="coconut" style={{ marginLeft:  '3px', top: '2px' }} />
    </div>
  );
}

// ─── Sunset Pulse — horizon pulse + bands ───────────────────────────────
function SunsetLayer() {
  return (
    <>
      <div className="sunset-pulse" />
      {[0, 1, 2].map(i => (
        <div key={i} className="sunset-band"
          style={{
            bottom: `${i * 6}%`,
            height: '18%',
            background: `linear-gradient(to top, rgba(${i === 0 ? '251,146,60' : i === 1 ? '244,114,182' : '253,186,116'},0.18), transparent)`,
            '--dur': `${4 + i * 1.2}s`, '--delay': `${i * 0.8}s`,
          }}
        />
      ))}
    </>
  );
}

// ─── Arctic Glow — ice cave + drifting snow + wind gusts ────────────────
function ArcticLayer() {
  const flakes = useMemo(() => Array.from({ length: 28 }, () => ({
    x: rand(0, 100), size: rand(1.5, 4),
    dur: rand(10, 18), delay: rand(0, 10),
    dx: rand(-30, 30),
  })), []);
  const gusts = useMemo(() => Array.from({ length: 6 }, (_, i) => ({
    top: 18 + i * 13, dur: rand(4, 7), delay: i * 1.3,
  })), []);
  const crystals = useMemo(() => Array.from({ length: 8 }, () => ({
    x: rand(15, 85), y: rand(35, 85),
    size: rand(6, 14),
  })), []);
  return (
    <>
      <div className="ice-cave-bg" />
      <div className="ice-wall l" />
      <div className="ice-wall r" />
      <div className="ice-stalactites" />
      <div className="ice-ground" />
      {crystals.map((c, i) => (
        <div key={`ic${i}`} className="ice-crystal"
          style={{
            left: `${c.x}%`, top: `${c.y}%`,
            width: c.size, height: c.size,
          }}
        />
      ))}
      {gusts.map((g, i) => (
        <div key={`g${i}`} className="wind-gust"
          style={{
            top: `${g.top}%`,
            '--dur': `${g.dur}s`, '--delay': `${g.delay}s`,
          }}
        />
      ))}
      {flakes.map((f, i) => (
        <div key={i} className="snow"
          style={{
            left: `${f.x}%`, width: f.size, height: f.size,
            '--dur': `${f.dur}s`, '--delay': `${f.delay}s`,
            '--dx': `${f.dx}px`,
          }}
        />
      ))}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// RARE — multiple animated layers
// ════════════════════════════════════════════════════════════════════════

// ─── Nebula — parallax cosmic clouds + sparkles (Wave 70 redesign)
// Cloud-forward, planet-free composition so it's clearly distinct from
// Galactic. 4 colored cloud blobs + dust lane + glowing core +
// sparkling 4-point stars over a bed of faint twinkling background.
function NebulaLayer() {
  const bgStars = useMemo(() => Array.from({ length: 120 }, () => ({
    x: rand(0, 100), y: rand(0, 100),
    size: rand(0.5, 1.8),
    op: rand(0.15, 0.5), opHigh: rand(0.7, 1),
    dur: rand(3, 8),
  })), []);
  const sparkles = useMemo(() => Array.from({ length: 26 }, () => ({
    x: rand(2, 98), y: rand(2, 96),
    s: rand(8, 20),
    dur: rand(2.2, 4.5),
    delay: rand(0, 4),
  })), []);
  return (
    <>
      <div className="neb-sky" />
      <div className="neb-cloud c3" />
      <div className="neb-cloud c1" />
      <div className="neb-cloud c2" />
      <div className="neb-cloud c4" />
      <div className="neb-cloud c5" />
      <div className="neb-dust" />
      <div className="neb-core" />
      {bgStars.map((s, i) => (
        <div key={i} className="star twinkle"
          style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: s.size, height: s.size,
            '--opacity-low': s.op, '--opacity-high': s.opHigh,
            '--dur': `${s.dur}s`,
          }}
        />
      ))}
      {sparkles.map((s, i) => (
        <div key={`sp${i}`} className="sparkle"
          style={{
            left: `${s.x}%`, top: `${s.y}%`,
            '--s': `${s.s}px`,
            '--dur': `${s.dur}s`, '--delay': `${s.delay}s`,
          }}
        />
      ))}
    </>
  );
}

// ─── Ember Core — bonfire + logs + flickering flame + rising sparks ─────
function EmberLayer() {
  const sparks = useMemo(() => Array.from({ length: 28 }, () => ({
    x: rand(40, 60), size: rand(2, 5),
    dur: rand(3, 6), delay: rand(0, 5),
    dx: rand(-50, 50), travel: rand(0.4, 0.7),
  })), []);
  return (
    <>
      <div className="bonfire-sky" />
      <div className="bonfire-logs c" />
      <div className="bonfire-logs b" />
      <div className="bonfire-logs" />
      <div className="bonfire-flame" />
      <div className="bonfire-flame inner" />
      {sparks.map((s, i) => (
        <div key={i} className="magma-spark"
          style={{
            left: `${s.x}%`, bottom: '18%',
            width: s.size, height: s.size,
            background: 'radial-gradient(circle, #fbbf24, #ef4444)',
            boxShadow: '0 0 8px rgba(251,146,60,0.7)',
            '--dur': `${s.dur}s`, '--delay': `${s.delay}s`,
            '--dx': `${s.dx}px`, '--travel': `${s.travel * 50}vh`,
          }}
        />
      ))}
    </>
  );
}

// ─── Volcanic — cone silhouette + erupting crater + lava streams
// cascading + launched magma blobs (Wave 70). Existing sparks/floor/
// smoke from Wave 65 are preserved.
function VolcanoLayer() {
  const sparks = useMemo(() => Array.from({ length: 30 }, () => ({
    x: rand(35, 65), size: rand(2, 5),
    dur: rand(2.5, 5), delay: rand(0, 5),
    dx: rand(-40, 40), travel: rand(0.4, 0.7),
    color: ['#fbbf24', '#f97316', '#ef4444', '#fde047'][Math.floor(rand(0, 4))],
  })), []);
  // Lava streams run from below the crater down each slope. Anchored
  // at the top (transform-origin) so rotation pivots at the crater;
  // heights are bounded so they never run off the cone.
  const streams = useMemo(() => [
    { left: '49%', top: '49%', h: 150, rot: -26, lw: 9, dur: 1.6 },
    { left: '47%', top: '50%', h: 120, rot: -34, lw: 6, dur: 2.1 },
    { left: '51%', top: '49%', h: 155, rot:  26, lw: 9, dur: 1.8 },
    { left: '53%', top: '50%', h: 118, rot:  34, lw: 6, dur: 2.3 },
    { left: '50%', top: '50%', h: 110, rot:   1, lw: 7, dur: 1.4 },
  ], []);
  // Eruption spray — blobs launched up out of the crater that arc away.
  const blobs = useMemo(() => Array.from({ length: 16 }, () => ({
    size: rand(5, 12),
    dx: rand(-120, 120),
    dy: rand(-200, -110),
    dur: rand(2, 3.4),
    delay: rand(0, 3),
  })), []);
  return (
    <>
      <div className="volcano-sky" />
      <div className="volcano-smoke" />
      <div className="volcano-cone" />
      {/* lava streams sit on the cone, under the crater glow */}
      {streams.map((s, i) => (
        <div key={`ls${i}`} className="lava-stream"
          style={{
            left: s.left, top: s.top, height: s.h,
            transform: `rotate(${s.rot}deg)`,
            '--lw': `${s.lw}px`, '--dur': `${s.dur}s`,
          }}
        />
      ))}
      <div className="volcano-eruption" />
      <div className="volcano-crater" />
      {blobs.map((b, i) => (
        <div key={`lb${i}`} className="lava-blob"
          style={{
            left: '50%', bottom: '50%',
            width: b.size, height: b.size,
            '--dx': `${b.dx}px`, '--dy': `${b.dy}px`,
            '--dur': `${b.dur}s`, '--delay': `${b.delay}s`,
          }}
        />
      ))}
      <div className="volcano-floor" />
      {sparks.map((s, i) => (
        <div key={i} className="magma-spark"
          style={{
            left: `${s.x}%`, width: s.size, height: s.size,
            background: s.color,
            boxShadow: `0 0 6px ${s.color}, 0 0 12px rgba(239,68,68,0.5)`,
            '--dur': `${s.dur}s`, '--delay': `${s.delay}s`,
            '--dx': `${s.dx}px`, '--travel': `${s.travel * 50}vh`,
          }}
        />
      ))}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// EPIC — full atmospheric animation
// ════════════════════════════════════════════════════════════════════════

// ─── Aurora — sweeping bands + arctic ridge + snowfield with reflection
// Wave 69: added the arctic mountain ridgeline in the middle distance
// and a snowfield in the foreground (whose ::before paints an aurora
// reflection) so the bands have a landscape to dance over instead of
// just floating in the void.
function AuroraLayer() {
  const bands = [
    { color: 'rgba(45,212,191,0.30)', delay: 0, dur: 9 },
    { color: 'rgba(167,139,250,0.24)', delay: 3, dur: 12 },
    { color: 'rgba(52,211,153,0.22)', delay: 6, dur: 10 },
  ];
  const stars = useMemo(() => Array.from({ length: 50 }, () => ({
    x: rand(0, 100), y: rand(0, 100),
    size: rand(0.5, 2),
    dur: rand(2, 6),
  })), []);
  return (
    <>
      <div className="aurora-base" />
      {bands.map((b, i) => (
        <div key={i} className="aurora-band"
          style={{
            top: `${i * 12}%`,
            background: `linear-gradient(180deg, transparent, ${b.color}, transparent)`,
            '--delay': `${b.delay}s`, '--dur': `${b.dur}s`,
          }}
        />
      ))}
      {stars.map((s, i) => (
        <div key={i} className="star twinkle"
          style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: s.size, height: s.size,
            '--opacity-low': 0.15, '--opacity-high': 0.5,
            '--dur': `${s.dur}s`,
          }}
        />
      ))}
      <div className="aurora-mountains" />
      <div className="aurora-snowfield" />
    </>
  );
}

// ─── Cyberpunk — building boxes with internal window grids (Wave 70).
// The old single-clip-path skyline + free-floating .cyber-window dots
// led to misalignment; now each building owns a grid of windows so
// they always sit INSIDE their building. Plus scanlines + flyers.
function CyberpunkLayer() {
  const COLORS = ['#06b6d4', '#e879f9', '#f0abfc', '#67e8f9', '#a5f3fc'];
  const buildings = useMemo(() => Array.from({ length: 18 }, () => {
    const cols = Math.floor(rand(2, 5));
    const rows = Math.floor(rand(3, 9));
    const winW = 4, winH = 5, gapX = 5, gapY = 4, padX = 5;
    const width = cols * winW + (cols - 1) * gapX + padX * 2;
    return {
      width,
      height: rows * (winH + gapY) + 14,
      cols,
      wins: Array.from({ length: cols * rows }, () => ({
        on: Math.random() > 0.25,
        color: COLORS[Math.floor(rand(0, COLORS.length))],
        dur: rand(3, 7),
        delay: rand(0, 6),
      })),
    };
  }), []);
  const flyers = useMemo(() => Array.from({ length: 3 }, (_, i) => ({
    top: 18 + i * 12,
    dur: rand(10, 20),
    delay: i * 5,
  })), []);
  return (
    <>
      <div className="cyber-sky" />
      <div className="cyber-grid" />
      <div className="cyber-buildings">
        {buildings.map((b, i) => (
          <div key={i} className="cyber-bldg"
            style={{
              width: b.width, height: b.height,
              gridTemplateColumns: `repeat(${b.cols}, 4px)`,
            }}
          >
            {b.wins.map((w, j) => (
              <div key={j} className="cyber-bldg-win"
                style={{
                  background: w.on ? w.color : 'rgba(255,255,255,0.04)',
                  color: w.color,
                  boxShadow: w.on ? `0 0 5px ${w.color}` : 'none',
                  '--dur': `${w.dur}s`, '--delay': `${w.delay}s`,
                  animationPlayState: w.on ? 'running' : 'paused',
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="cyber-edge l" />
      <div className="cyber-edge r" />
      {flyers.map((f, i) => (
        <div key={i} className="cyber-flyer"
          style={{
            top: `${f.top}%`,
            '--dur': `${f.dur}s`, '--delay': `${f.delay}s`,
          }}
        />
      ))}
      <div className="cyber-scan" style={{ '--delay': '0s' }} />
      <div className="cyber-scan" style={{ '--delay': '3s' }} />
    </>
  );
}

// ─── Galactic — deep space parallax + planet + spiral + shooting stars ──
function GalaxyLayer() {
  const far = useMemo(() => Array.from({ length: 160 }, () => ({
    x: rand(0, 100), y: rand(0, 100),
    size: rand(0.4, 1.5),
    op: rand(0.2, 0.6), opHigh: rand(0.7, 1),
    dur: rand(3, 7),
  })), []);
  const mid = useMemo(() => Array.from({ length: 60 }, () => ({
    x: rand(0, 100), y: rand(0, 100),
    size: rand(1, 2.5),
    op: rand(0.3, 0.6), opHigh: 1,
    dur: rand(4, 8),
    dx: rand(-30, 30),
  })), []);
  const near = useMemo(() => Array.from({ length: 18 }, () => ({
    x: rand(0, 100), y: rand(0, 100),
    size: rand(1.8, 4),
    dur: rand(2.5, 5.5),
    dx: rand(-60, 60),
    tint: ['#fff', '#e0e7ff', '#fde68a', '#fbcfe8'][Math.floor(rand(0, 4))],
  })), []);
  const shooting = useMemo(() => Array.from({ length: 4 }, (_, i) => ({
    x: rand(10, 70), y: rand(5, 35),
    angle: rand(25, 45),
    delay: i * 7 + rand(0, 5),
    dur: rand(1.6, 2.4),
  })), []);
  // Wave 70: a few small spiral galaxies floating in the deep field,
  // each slowly rotating at its own pace.
  const galaxies = useMemo(() => [
    { x: 14, y: 22, g: 150, dur: 70, op: 0.7,  rev: false },
    { x: 78, y: 30, g: 110, dur: 90, op: 0.6,  rev: true  },
    { x: 64, y: 68, g: 90,  dur: 60, op: 0.5,  rev: false },
    { x: 30, y: 74, g: 70,  dur: 80, op: 0.45, rev: true  },
  ], []);
  return (
    <>
      <div className="galaxy-grad" />
      <div className="galaxy-milky" />
      <div className="galaxy-spiral" />
      <div className="galaxy-spiral b" />
      {galaxies.map((g, i) => (
        <div key={`mg${i}`} className={`mini-galaxy ${g.rev ? 'rev' : ''}`}
          style={{
            left: `${g.x}%`, top: `${g.y}%`,
            '--g': `${g.g}px`, '--dur': `${g.dur}s`, '--op': g.op,
          }}
        />
      ))}
      <div className="galaxy-planet" />
      <div className="galaxy-planet-ring" />
      {far.map((s, i) => (
        <div key={`f${i}`} className="star twinkle"
          style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: s.size, height: s.size,
            '--opacity-low': s.op, '--opacity-high': s.opHigh,
            '--dur': `${s.dur}s`,
          }}
        />
      ))}
      {mid.map((s, i) => (
        <div key={`m${i}`} className="star drift"
          style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: s.size, height: s.size,
            boxShadow: '0 0 4px rgba(196,181,253,0.7)',
            '--opacity-low': s.op, '--opacity-high': s.opHigh,
            '--dur': `${s.dur}s`, '--dx': `${s.dx}px`,
          }}
        />
      ))}
      {near.map((s, i) => (
        <div key={`n${i}`} className="star near"
          style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: s.size, height: s.size,
            '--tint': s.tint,
            '--dur': `${s.dur}s`, '--dx': `${s.dx}px`,
          }}
        />
      ))}
      {shooting.map((s, i) => (
        <div key={`sh${i}`} className="shooting-star"
          style={{
            left: `${s.x}%`, top: `${s.y}%`,
            '--angle': `${s.angle}deg`,
            '--delay': `${s.delay}s`, '--dur': `${s.dur}s`,
          }}
        />
      ))}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// LEGENDARY — chrome-transforming
// ════════════════════════════════════════════════════════════════════════

// ─── Prismatic — legendary spectacle (Wave 70 polish).
// Faster, fuller chroma sweep on --primary AND --accent (the entire
// UI cycles through the spectrum). 18 rotating rainbow ray beams,
// 10 orbiting prism shards, expanding burst rings, color-cycling
// grid mask, and 70 sparkle particles.
function PrismLayer() {
  const hueRef = useRef(0);
  useEffect(() => {
    const root = document.documentElement;
    const tick = () => {
      // 0.8°/tick (was 0.3°) — fuller chroma sweep so the spectrum
      // walks past you fast enough to feel legendary.
      hueRef.current = (hueRef.current + 0.8) % 360;
      const h = Math.round(hueRef.current);
      root.style.setProperty('--primary', `${h} 90% 62%`);
      root.style.setProperty('--ring',    `${h} 90% 62%`);
      root.style.setProperty('--sidebar-primary', `${h} 90% 62%`);
      root.style.setProperty('--sidebar-ring',    `${h} 90% 62%`);
      root.style.setProperty('--accent', `${(h + 180) % 360} 70% 30%`);
    };
    const id = setInterval(tick, 32);
    return () => clearInterval(id);
  }, []);
  const particles = useMemo(() => Array.from({ length: 70 }, () => ({
    x: rand(0, 100), y: rand(0, 100),
    size: rand(1, 6), dur: rand(1.2, 4), delay: rand(0, 4),
  })), []);
  const rays = useMemo(() => {
    const colors = [
      'rgba(244,63,94,0.6)',
      'rgba(251,146,60,0.6)',
      'rgba(250,204,21,0.6)',
      'rgba(34,197,94,0.6)',
      'rgba(59,130,246,0.6)',
      'rgba(168,85,247,0.6)',
    ];
    return Array.from({ length: 18 }, (_, i) => ({
      rot: i * 20,
      color: colors[i % colors.length],
      dur: rand(3, 6),
      delay: rand(0, 4),
    }));
  }, []);
  const shards = useMemo(() => {
    const cols = ['#f0abfc', '#a5f3fc', '#fde68a', '#bbf7d0', '#bfdbfe', '#fbcfe8'];
    return Array.from({ length: 10 }, (_, i) => ({
      rot: i * 36,
      col: cols[i % cols.length],
      dur: rand(7, 12),
      delay: rand(0, 5),
    }));
  }, []);
  return (
    <>
      <div className="prism-halo" />
      <div className="prism-grid" />
      <div className="prism-burst" />
      <div className="prism-core" />
      {rays.map((r, i) => (
        <div key={`ray${i}`} className="prism-ray"
          style={{
            transform: `translateX(-50%) rotate(${r.rot}deg)`,
            background: `linear-gradient(to bottom, transparent, ${r.color}, transparent)`,
            '--dur': `${r.dur}s`, '--delay': `${r.delay}s`,
          }}
        />
      ))}
      {shards.map((s, i) => (
        <div key={`shard${i}`} className="prism-shard"
          style={{
            '--rot': `${s.rot}deg`, '--col': s.col,
            '--dur': `${s.dur}s`, '--delay': `${s.delay}s`,
          }}
        />
      ))}
      {particles.map((p, i) => (
        <div key={i} className="prism-particle"
          style={{
            left: `${p.x}%`, top: `${p.y}%`,
            width: p.size, height: p.size,
            '--dur': `${p.dur}s`, '--delay': `${p.delay}s`,
          }}
        />
      ))}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// LEGACY — kept for the base "Brushed Steel" theme (admin-only).
// Uses Framer Motion since it pre-dates the CSS-keyframe scene system.
// ════════════════════════════════════════════════════════════════════════
function SteelUsaLayer() {
  // Patriotic embers + steel pixels — pre-Wave-65 motion. Uses
  // Framer Motion (the only scene that does — kept for the admin
  // Brushed Steel base theme).
  const USA_COLORS = ['#EF4444', '#FFFFFF', '#3B82F6', '#EF4444', '#FFFFFF', '#1D4ED8'];
  const PIXEL_COLORS = ['#94A3B8', '#CBD5E1', '#64748B', '#BAE6FD', '#E2E8F0'];
  const embers = useMemo(() =>
    Array.from({ length: 196 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      size: Math.random() * 3.5 + 1.5,
      color: USA_COLORS[i % USA_COLORS.length],
      duration: Math.random() * 5 + 3,
      delay: Math.random() * 6,
      drift: (Math.random() - 0.5) * 50,
      travel: Math.random() * 0.5 + 0.45,
    })),
  []);
  const pixels = useMemo(() =>
    Array.from({ length: 20 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 3 + 2,
      color: PIXEL_COLORS[i % PIXEL_COLORS.length],
      duration: Math.random() * 6 + 4,
      delay: Math.random() * 5,
    })),
  []);
  const vh = (typeof window !== 'undefined' && window.innerHeight) || 800;
  return (
    <>
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(160deg, rgba(148,163,184,0.07) 0%, rgba(30,41,59,0.10) 50%, rgba(148,163,184,0.05) 100%)',
        }}
      />
      {embers.map(e => (
        <motion.div
          key={`ember-${e.id}`}
          className="absolute rounded-full"
          style={{
            left: `${e.x}%`, bottom: 0,
            width: e.size, height: e.size,
            background: e.color, filter: 'blur(0.4px)', opacity: 0,
          }}
          animate={{
            y: [0, -(vh * e.travel)],
            x: [0, e.drift],
            opacity: [0, 0.7, 0],
            scale: [1, 0.4],
          }}
          transition={{ duration: e.duration, repeat: Infinity, delay: e.delay, ease: 'easeOut' }}
        />
      ))}
      {pixels.map(p => (
        <motion.div
          key={`pixel-${p.id}`}
          className="absolute"
          style={{
            left: `${p.x}%`, top: `${p.y}%`,
            width: p.size, height: p.size,
            background: p.color, borderRadius: 1, opacity: 0,
          }}
          animate={{
            opacity: [0, 0.45, 0],
            scale: [0.8, 1.4, 0.8],
          }}
          transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'easeInOut' }}
        />
      ))}
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════
// WAVE 2 — collectible scene drop (Claude Design handoff)
// Zen Garden (common), Deep Ocean Abyss (rare), Storm Chaser (epic),
// Underwater Kingdom (legendary), Dragon's Lair (mythic).
// CSS + @keyframes live in src/index.css (Wave-2 loot theme scenes block).
// ════════════════════════════════════════════════════════════════════════

// ─── Zen Garden (common) — raked sand, stones, drifting maple leaves ───────
function ZenGardenLayer() {
  const stones = useMemo(() => [
    { x: 24, y: 58, w: 70, h: 44 },
    { x: 33, y: 66, w: 40, h: 26 },
    { x: 58, y: 74, w: 54, h: 34 },
  ], []);
  const leaves = useMemo(() => Array.from({ length: 14 }, () => ({
    x: rand(40, 100), dur: rand(13, 24), delay: rand(0, 18), dx: rand(-90, 30),
  })), []);
  return (
    <>
      <div className="zen-bg" />
      <div className="zen-rake" />
      {stones.map((s, i) => (
        <Fragment key={i}>
          <div className="zen-ring" style={{
            left: `calc(${s.x}% - ${s.w * 0.45}px)`, top: `calc(${s.y}% - ${s.h * 0.55}px)`,
            width: s.w * 1.9, height: s.h * 2.1,
          }} />
          <div className="zen-ring" style={{
            left: `calc(${s.x}% - ${s.w * 0.9}px)`, top: `calc(${s.y}% - ${s.h * 1.05}px)`,
            width: s.w * 2.8, height: s.h * 3.1, opacity: 0.55,
          }} />
          <div className="zen-stone" style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.w, height: s.h }} />
        </Fragment>
      ))}
      <div className="zen-trunk" />
      <div className="zen-canopy" />
      <div className="zen-lantern"><div className="zen-lantern-glow" /></div>
      {leaves.map((l, i) => (
        <div key={`lf${i}`} className="zen-leaf" style={{
          left: `${l.x}%`,
          '--dur': `${l.dur}s`, '--delay': `${l.delay}s`, '--dx': `${l.dx}px`,
        }} />
      ))}
    </>
  );
}

// ─── Deep Ocean Abyss (rare) — marine snow, jellies, anglerfish ────────────
function AbyssLayer() {
  const snowFlakes = useMemo(() => Array.from({ length: 36 }, () => ({
    x: rand(0, 100), size: rand(1, 2.5),
    dur: rand(16, 30), delay: -rand(0, 28), dx: rand(-20, 20),
  })), []);
  const jellies = useMemo(() => Array.from({ length: 6 }, (_, i) => ({
    x: rand(8, 88), bottom: rand(-18, -4), jw: rand(30, 58),
    dur: rand(34, 55),
    // negative delays pre-warm the scene — half the jellies are already
    // mid-rise the moment the theme is equipped.
    delay: i < 3 ? -rand(8, 22) : rand(4, 18),
  })), []);
  const shafts = useMemo(() => [
    { x: 22, dur: 11, delay: 0 }, { x: 48, dur: 13, delay: 4 }, { x: 70, dur: 10, delay: 7 },
  ], []);
  return (
    <>
      <div className="aby-bg" />
      {shafts.map((s, i) => (
        <div key={`sh${i}`} className="aby-shaft" style={{
          left: `${s.x}%`, '--dur': `${s.dur}s`, '--delay': `${s.delay}s`,
        }} />
      ))}
      {snowFlakes.map((f, i) => (
        <div key={`ms${i}`} className="snow" style={{
          left: `${f.x}%`, width: f.size, height: f.size,
          boxShadow: '0 0 3px rgba(125,211,252,0.5)', opacity: 0,
          '--dur': `${f.dur}s`, '--delay': `${f.delay}s`, '--dx': `${f.dx}px`,
        }} />
      ))}
      {jellies.map((j, i) => (
        <div key={`j${i}`} className="aby-jelly" style={{
          left: `${j.x}%`, bottom: `${j.bottom}%`,
          '--jw': `${j.jw}px`, '--dur': `${j.dur}s`, '--delay': `${j.delay}s`,
        }}>
          <div className="aby-bell" style={{ '--jw': `${j.jw}px` }} />
        </div>
      ))}
      <div className="aby-fish" style={{ left: '58%', top: '62%', '--dur': '28s' }}>
        <div className="aby-fish-body" />
        <div className="aby-tooth" />
        <div className="aby-lure" />
      </div>
    </>
  );
}

// ─── Storm Chaser (epic) — supercell, rain, lightning strikes ──────────────
function StormChaserLayer() {
  const clouds = useMemo(() => Array.from({ length: 8 }, (_, i) => ({
    x: (i * 14) - 8 + rand(-4, 4), y: rand(-8, 18),
    w: rand(280, 480), h: rand(90, 150),
    dur: rand(13, 22), delay: rand(0, 8), dx: rand(-60, 60),
  })), []);
  const rain = useMemo(() => Array.from({ length: 44 }, () => ({
    x: rand(0, 110), dur: rand(0.7, 1.3), delay: rand(0, 1.4),
  })), []);
  const strikes = useMemo(() => [
    { fx: 28, dur: 9, delay: 0 },
    { fx: 72, dur: 12.5, delay: 4.2 },
  ], []);
  return (
    <>
      <div className="stm-sky" />
      <div className="stm-horizon" />
      {clouds.map((c, i) => (
        <div key={`c${i}`} className="stm-cloud" style={{
          left: `${c.x}%`, top: `${c.y}%`, width: c.w, height: c.h,
          '--dur': `${c.dur}s`, '--delay': `${c.delay}s`, '--dx': `${c.dx}px`,
        }} />
      ))}
      {rain.map((r, i) => (
        <div key={`r${i}`} className="stm-rain" style={{
          left: `${r.x}%`, '--dur': `${r.dur}s`, '--delay': `${r.delay}s`,
        }} />
      ))}
      {strikes.map((s, i) => (
        <Fragment key={`s${i}`}>
          <div className="stm-flash" style={{
            '--fx': `${s.fx}%`, '--dur': `${s.dur}s`, '--delay': `${s.delay}s`,
          }} />
          <div className="stm-bolt" style={{
            '--fx': `${s.fx}%`, '--dur': `${s.dur}s`, '--delay': `${s.delay}s`,
          }} />
        </Fragment>
      ))}
    </>
  );
}

// ─── Underwater Kingdom (legendary) — sunken palace, fish, god rays ────────
function UnderwaterKingdomLayer() {
  const GOLD = '#fcd34d';
  const towers = useMemo(() => [
    { cols: 2, rows: 4, domeW: 46 }, { cols: 3, rows: 7, domeW: 64 },
    { cols: 4, rows: 9, domeW: 86, gate: true }, { cols: 3, rows: 6, domeW: 64 },
    { cols: 2, rows: 5, domeW: 46 },
  ].map(t => {
    const winW = 6, gapX = 9, padX = 9;
    const width = t.cols * winW + (t.cols - 1) * gapX + padX * 2;
    return {
      ...t, width,
      height: t.rows * 17 + 38,
      wins: Array.from({ length: t.cols * t.rows }, () => ({
        on: Math.random() > 0.3,
        dur: rand(3, 8), delay: rand(0, 6),
      })),
    };
  }), []);
  const bubbles = useMemo(() => Array.from({ length: 16 }, () => ({
    x: rand(5, 95), size: rand(4, 11),
    dur: rand(8, 16), delay: rand(0, 12), dx: rand(-30, 30),
  })), []);
  const glints = useMemo(() => Array.from({ length: 14 }, () => ({
    x: rand(20, 80), y: rand(58, 92), s: rand(8, 16),
    dur: rand(2.2, 4.5), delay: rand(0, 5),
  })), []);
  const kelp = useMemo(() => [
    { x: 4, kh: 200, dur: 6 }, { x: 8, kh: 140, dur: 7.2 }, { x: 13, kh: 170, dur: 5.4 },
    { x: 87, kh: 180, dur: 6.6 }, { x: 92, kh: 220, dur: 5.8 }, { x: 96, kh: 150, dur: 7 },
  ], []);
  const rays = useMemo(() => [
    { x: 16, dur: 8, delay: 0 }, { x: 38, dur: 11, delay: 3 },
    { x: 60, dur: 9, delay: 5 }, { x: 80, dur: 12, delay: 1.5 },
  ], []);
  const schools = useMemo(() => [
    { top: 26, dur: 34, delay: 0, rev: false },
    { top: 44, dur: 42, delay: 8, rev: true },
  ], []);
  const fishOffsets = useMemo(() => Array.from({ length: 8 }, () => ({
    x: rand(0, 100), y: rand(0, 100),
  })), []);
  return (
    <>
      <div className="ukg-water" />
      <div className="caustic" />
      {rays.map((r, i) => (
        <div key={`r${i}`} className="ukg-ray" style={{
          left: `${r.x}%`, '--dur': `${r.dur}s`, '--delay': `${r.delay}s`,
        }} />
      ))}
      <div className="ukg-palace">
        {towers.map((t, i) => (
          <div key={i} className="ukg-tower" style={{
            width: t.width, height: t.height,
            gridTemplateColumns: `repeat(${t.cols}, 6px)`,
          }}>
            <div className="ukg-dome" style={{ width: t.domeW, height: t.domeW * 0.62 }} />
            {t.wins.map((w, j) => (
              <div key={j} className="ukg-win" style={{
                background: w.on ? GOLD : 'rgba(255,255,255,0.05)',
                color: GOLD,
                boxShadow: w.on ? `0 0 7px ${GOLD}` : 'none',
                '--dur': `${w.dur}s`, '--delay': `${w.delay}s`,
                animationPlayState: w.on ? 'running' : 'paused',
              }} />
            ))}
            {t.gate && <div className="ukg-gate" />}
          </div>
        ))}
      </div>
      {kelp.map((k, i) => (
        <div key={`k${i}`} className="ukg-kelp" style={{
          left: `${k.x}%`, '--kh': `${k.kh}px`, '--dur': `${k.dur}s`,
        }} />
      ))}
      {schools.map((s, i) => (
        <div key={`sc${i}`} className={`ukg-school ${s.rev ? 'rev' : ''}`} style={{
          top: `${s.top}%`, '--dur': `${s.dur}s`, '--delay': `${s.delay}s`,
        }}>
          {fishOffsets.map((f, j) => (
            <div key={j} className="ukg-fish" style={{ left: `${f.x}%`, top: `${f.y}%` }} />
          ))}
        </div>
      ))}
      {glints.map((g, i) => (
        <div key={`g${i}`} className="sparkle gold" style={{
          left: `${g.x}%`, top: `${g.y}%`,
          '--s': `${g.s}px`, '--dur': `${g.dur}s`, '--delay': `${g.delay}s`,
        }} />
      ))}
      {bubbles.map((b, i) => (
        <div key={`b${i}`} className="bubble" style={{
          left: `${b.x}%`, bottom: '4%', width: b.size, height: b.size,
          '--dur': `${b.dur}s`, '--delay': `${b.delay}s`, '--dx': `${b.dx}px`,
        }} />
      ))}
    </>
  );
}

// ─── Dragon's Lair (mythic) — gold hoard, dragon eyes, fire breath ─────────
function DragonsLairLayer() {
  // Mythic = reactive chrome: the accent system breathes gold↔ember.
  // Improved over Prismatic per the 2026-06 perf audit — the interval
  // pauses while the tab is hidden and is skipped entirely under
  // prefers-reduced-motion (a JS interval isn't stopped by the CSS
  // reduced-motion rule), settling on a static molten-gold accent.
  useEffect(() => {
    const root = document.documentElement;
    const reduce = typeof window !== 'undefined'
      && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      root.style.setProperty('--primary', '32 95% 55%');
      root.style.setProperty('--ring', '32 95% 55%');
      return;
    }
    let t = 0;
    let id = null;
    const tick = () => {
      t += 0.05;
      const hue = Math.round(30 + 10 * Math.sin(t));
      const lit = Math.round(54 + 5 * Math.sin(t * 1.6));
      root.style.setProperty('--primary', `${hue} 95% ${lit}%`);
      root.style.setProperty('--ring', `${hue} 95% ${lit}%`);
    };
    const start = () => { if (id == null) id = setInterval(tick, 50); };
    const stop = () => { if (id != null) { clearInterval(id); id = null; } };
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVis);
    start();
    return () => { stop(); document.removeEventListener('visibilitychange', onVis); };
  }, []);
  const embers = useMemo(() => Array.from({ length: 26 }, () => ({
    x: rand(20, 80), size: rand(2, 5),
    dur: rand(3, 6.5), delay: rand(0, 6),
    dx: rand(-60, 60), travel: rand(0.3, 0.6),
    color: ['#fbbf24', '#f97316', '#fde047'][Math.floor(rand(0, 3))],
  })), []);
  const coins = useMemo(() => Array.from({ length: 18 }, () => ({
    x: rand(8, 92), y: rand(76, 94), size: rand(5, 11),
  })), []);
  const glints = useMemo(() => Array.from({ length: 16 }, () => ({
    x: rand(8, 92), y: rand(72, 95), s: rand(8, 18),
    dur: rand(2, 4), delay: rand(0, 4),
  })), []);
  return (
    <>
      <div className="drg-bg" />
      <div className="drg-wall l" />
      <div className="drg-wall r" />
      <div className="drg-rocks" />
      <div className="drg-firewash" />
      <div className="drg-breath" />
      <div className="drg-eyes">
        <div className="drg-eye" style={{ '--tilt': '5deg' }} />
        <div className="drg-eye" style={{ '--tilt': '-5deg' }} />
      </div>
      <div className="drg-nostril-smoke" style={{ left: '38%', top: '32%', '--dur': '6s' }} />
      <div className="drg-nostril-smoke" style={{ left: '54%', top: '32%', '--dur': '7.5s', '--delay': '1.4s' }} />
      <div className="drg-hoard" />
      {coins.map((c, i) => (
        <div key={`c${i}`} className="drg-coin" style={{
          left: `${c.x}%`, top: `${c.y}%`, width: c.size, height: c.size * 0.8,
        }} />
      ))}
      {glints.map((g, i) => (
        <div key={`g${i}`} className="sparkle gold" style={{
          left: `${g.x}%`, top: `${g.y}%`,
          '--s': `${g.s}px`, '--dur': `${g.dur}s`, '--delay': `${g.delay}s`,
        }} />
      ))}
      {embers.map((e, i) => (
        <div key={`e${i}`} className="magma-spark" style={{
          left: `${e.x}%`, bottom: '20%', width: e.size, height: e.size,
          background: e.color,
          boxShadow: `0 0 7px ${e.color}, 0 0 14px rgba(249,115,22,0.5)`,
          '--dur': `${e.dur}s`, '--delay': `${e.delay}s`,
          '--dx': `${e.dx}px`, '--travel': `${e.travel * 60}vh`,
        }} />
      ))}
    </>
  );
}

// ─── Desert Mirage (uncommon) — pyramids, dunes, a dissolving oasis ────────
function DesertMirageLayer() {
  const wisps = useMemo(() => Array.from({ length: 5 }, (_, i) => ({
    top: 62 + i * 6, dur: rand(5, 9), delay: i * 1.7,
  })), []);
  return (
    <>
      <div className="mir-sky" />
      <div className="mir-sun" />
      <div className="mir-pyramid" style={{ left: '56%', width: 200, height: 120 }} />
      <div className="mir-pyramid" style={{ left: '74%', width: 130, height: 80, opacity: 0.85 }} />
      <div className="mir-dunes-far" />
      <div className="mir-dunes-near" />
      <div className="mir-haze" />
      <div className="mir-oasis">
        <div className="mir-pool" />
        <div className="palm" style={{ left: '14%', '--base': '20px', '--ph': '86px', '--dur': '5s' }}>
          <div className="palm-trunk" />
          <div className="palm-frond f1" /><div className="palm-frond f2" />
          <div className="palm-frond f3" /><div className="palm-frond f4" />
          <div className="palm-frond f5" /><div className="palm-frond f6" />
        </div>
        <div className="palm" style={{ left: '66%', '--base': '18px', '--ph': '64px', '--dur': '6s', '--delay': '1s' }}>
          <div className="palm-trunk" />
          <div className="palm-frond f1" /><div className="palm-frond f2" />
          <div className="palm-frond f3" /><div className="palm-frond f4" />
        </div>
      </div>
      {wisps.map((w, i) => (
        <div key={i} className="mir-sandwisp" style={{
          top: `${w.top}%`, '--dur': `${w.dur}s`, '--delay': `${w.delay}s`,
        }} />
      ))}
    </>
  );
}

// ─── Mountain Summit (uncommon) — peak above a sea of clouds ───────────────
function MountainSummitLayer() {
  const clouds = useMemo(() => Array.from({ length: 9 }, (_, i) => ({
    x: (i * 12) - 6 + rand(-4, 4), y: 68 + rand(0, 18),
    w: rand(180, 360), h: rand(48, 90),
    dur: rand(14, 26), delay: rand(0, 8), dx: rand(-80, 80),
    op: rand(0.65, 0.95),
  })), []);
  const birds = useMemo(() => Array.from({ length: 3 }, (_, i) => ({
    top: 14 + i * 9, dur: rand(22, 34), delay: i * 9,
  })), []);
  return (
    <>
      <div className="smt-sky" />
      {birds.map((b, i) => (
        <div key={`bd${i}`} className="gull" style={{
          top: `${b.top}%`, '--dur': `${b.dur}s`, '--delay': `${b.delay}s`,
        }} />
      ))}
      <div className="smt-peak" />
      <div className="smt-flag" />
      {clouds.map((c, i) => (
        <div key={i} className="smt-cloud" style={{
          left: `${c.x}%`, top: `${c.y}%`, width: c.w, height: c.h, opacity: c.op,
          '--dur': `${c.dur}s`, '--delay': `${c.delay}s`, '--dx': `${c.dx}px`,
        }} />
      ))}
    </>
  );
}

// ─── Ancient Temple (rare) — torchlit stone hall, glowing glyphs ───────────
function AncientTempleLayer() {
  const cols = useMemo(() => [12, 28, 44, 60, 76].map(x => ({ x: x + 4 })), []);
  const glyphs = useMemo(() => Array.from({ length: 16 }, () => ({
    x: rand(6, 94), y: rand(20, 56),
    kind: ['diamond', 'bar', 'dot'][Math.floor(rand(0, 3))],
    dur: rand(3, 7), delay: rand(0, 6),
  })), []);
  const motes = useMemo(() => Array.from({ length: 10 }, () => ({
    x: rand(10, 90), y: rand(30, 80),
    dx: rand(-24, 24), dy: rand(-30, 6),
    dur: rand(6, 11), delay: rand(0, 7),
  })), []);
  return (
    <>
      <div className="tpl-bg" />
      <div className="tpl-roof" />
      <div className="tpl-beam" />
      {cols.map((c, i) => (
        <div key={i} className="tpl-col" style={{ left: `${c.x}%` }} />
      ))}
      <div className="tpl-steps" />
      {glyphs.map((g, i) => (
        <div key={`gl${i}`} className={`tpl-glyph ${g.kind}`} style={{
          left: `${g.x}%`, top: `${g.y}%`,
          '--dur': `${g.dur}s`, '--delay': `${g.delay}s`,
        }} />
      ))}
      <div className="tpl-torch" style={{ left: '16%' }}>
        <div className="tpl-torch-glow" /><div className="tpl-torch-flame" style={{ marginLeft: -13 }} />
      </div>
      <div className="tpl-torch" style={{ right: '16%' }}>
        <div className="tpl-torch-glow" /><div className="tpl-torch-flame" style={{ marginLeft: -13 }} />
      </div>
      {motes.map((m, i) => (
        <div key={`mt${i}`} className="firefly" style={{
          left: `${m.x}%`, top: `${m.y}%`, width: 3, height: 3,
          '--dx': `${m.dx}px`, '--dy': `${m.dy}px`,
          '--dur': `${m.dur}s`, '--delay': `${m.delay}s`,
        }} />
      ))}
    </>
  );
}

// ─── Waterfall Sanctuary (rare) — falls, mist, rainbow, lush cliffs ────────
function WaterfallLayer() {
  const foliage = useMemo(() => [
    { x: -2, y: 2, s: 120 }, { x: 8, y: 14, s: 85 }, { x: -1, y: 32, s: 100 },
    { x: 9, y: 48, s: 72 }, { x: 3, y: 64, s: 88 },
    { x: 90, y: 3, s: 110 }, { x: 84, y: 20, s: 80 },
    { x: 92, y: 38, s: 95 }, { x: 86, y: 56, s: 70 }, { x: 93, y: 70, s: 84 },
  ], []);
  const spray = useMemo(() => Array.from({ length: 12 }, () => ({
    x: rand(36, 64), size: rand(3, 7),
    dur: rand(5, 10), delay: rand(0, 8), dx: rand(-40, 40),
  })), []);
  return (
    <>
      <div className="wfs-bg" />
      <div className="wfs-fall" style={{ marginLeft: -35, '--fw': '70px', '--dur': '1.1s' }} />
      <div className="wfs-fall" style={{ marginLeft: -62, '--fw': '22px', '--dur': '1.5s', opacity: 0.7 }} />
      <div className="wfs-fall" style={{ marginLeft: 42, '--fw': '18px', '--dur': '1.3s', opacity: 0.7 }} />
      <div className="wfs-cliff l" />
      <div className="wfs-cliff r" />
      {foliage.map((f, i) => (
        <div key={i} className="wfs-foliage" style={{
          left: `${f.x}%`, top: `${f.y}%`, width: f.s, height: f.s * 0.8,
        }} />
      ))}
      <div className="wfs-pool" />
      <div className="wfs-mist" />
      <div className="wfs-rainbow" />
      {spray.map((s, i) => (
        <div key={`sp${i}`} className="wfs-spray" style={{
          left: `${s.x}%`, bottom: '16%', width: s.size, height: s.size,
          '--dur': `${s.dur}s`, '--delay': `${s.delay}s`, '--dx': `${s.dx}px`,
        }} />
      ))}
    </>
  );
}

// ─── Lunar Colony (epic) — regolith, habitat domes, Earthrise ──────────────
function LunarColonyLayer() {
  const stars = useMemo(() => Array.from({ length: 130 }, () => ({
    x: rand(0, 100), y: rand(0, 68),
    size: rand(0.5, 2), op: rand(0.2, 0.55), opHigh: rand(0.7, 1),
    dur: rand(3, 7),
  })), []);
  const craters = useMemo(() => [
    { x: 8, y: 80, w: 90, h: 26 }, { x: 30, y: 90, w: 50, h: 14 },
    { x: 62, y: 84, w: 70, h: 20 }, { x: 84, y: 92, w: 44, h: 12 },
    { x: 46, y: 78, w: 36, h: 10 },
  ], []);
  const domeLights = useMemo(() => Array.from({ length: 14 }, () => ({
    x: rand(12, 84), y: rand(35, 80),
    color: ['#fbbf24', '#a5f3fc', '#fef9c3'][Math.floor(rand(0, 3))],
    dur: rand(3, 8), delay: rand(0, 6),
  })), []);
  const shooting = useMemo(() => Array.from({ length: 2 }, (_, i) => ({
    x: rand(15, 60), y: rand(6, 26), angle: rand(28, 42),
    delay: i * 9 + rand(0, 4), dur: rand(1.6, 2.2),
  })), []);
  return (
    <>
      <div className="lun-sky" />
      {stars.map((s, i) => (
        <div key={i} className="star twinkle" style={{
          left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size,
          '--opacity-low': s.op, '--opacity-high': s.opHigh, '--dur': `${s.dur}s`,
        }} />
      ))}
      {shooting.map((s, i) => (
        <div key={`st${i}`} className="shooting-star" style={{
          left: `${s.x}%`, top: `${s.y}%`,
          '--angle': `${s.angle}deg`, '--delay': `${s.delay}s`, '--dur': `${s.dur}s`,
          animationIterationCount: 'infinite',
        }} />
      ))}
      <div className="lun-earth" />
      <div className="lun-ground" />
      {craters.map((c, i) => (
        <div key={`cr${i}`} className="lun-crater" style={{
          left: `${c.x}%`, top: `${c.y}%`, width: c.w, height: c.h,
        }} />
      ))}
      <div className="lun-dome" style={{ left: '54%', bottom: '24%', width: 190, height: 95 }}>
        {domeLights.slice(0, 8).map((l, i) => (
          <div key={i} className="lun-light" style={{
            left: `${l.x}%`, top: `${l.y}%`, background: l.color, color: l.color,
            '--dur': `${l.dur}s`, '--delay': `${l.delay}s`,
          }} />
        ))}
      </div>
      <div className="lun-dome" style={{ left: '76%', bottom: '24%', width: 110, height: 58 }}>
        {domeLights.slice(8).map((l, i) => (
          <div key={i} className="lun-light" style={{
            left: `${l.x}%`, top: `${l.y}%`, background: l.color, color: l.color,
            '--dur': `${l.dur}s`, '--delay': `${l.delay}s`,
          }} />
        ))}
      </div>
      <div className="lun-tunnel" style={{ left: '70.5%', bottom: '24%', width: 70 }} />
      <div className="lun-mast" style={{ left: '50%', bottom: '24%', height: 90 }}>
        <div className="lun-beacon" />
      </div>
    </>
  );
}

// ─── Enchanted Forest (epic) — glowing mushrooms, wisps, god rays ──────────
function EnchantedForestLayer() {
  const trunks = useMemo(() => [
    { x: 4, tw: 36, th: 76, op: 0.95 }, { x: 13, tw: 22, th: 60, op: 0.7 },
    { x: 24, tw: 28, th: 70, op: 0.85 }, { x: 70, tw: 26, th: 66, op: 0.8 },
    { x: 82, tw: 38, th: 78, op: 0.95 }, { x: 93, tw: 24, th: 62, op: 0.75 },
  ], []);
  const shroomCols = ['#67e8f9', '#c084fc', '#5eead4', '#f0abfc'];
  const shrooms = useMemo(() => [
    { x: 9, b: 2, cw: 44 }, { x: 14, b: 1, cw: 26 },
    { x: 30, b: 3, cw: 34 }, { x: 34, b: 1, cw: 20 },
    { x: 56, b: 2, cw: 40 }, { x: 61, b: 1, cw: 22 },
    { x: 78, b: 2, cw: 30 }, { x: 90, b: 3, cw: 38 },
  ].map((s, i) => ({
    ...s, col: shroomCols[i % shroomCols.length],
    dur: rand(3, 6), delay: rand(0, 4),
  })), []);
  const wisps = useMemo(() => Array.from({ length: 8 }, (_, i) => ({
    x: rand(8, 92), y: rand(25, 75), ws: rand(5, 11),
    col: ['#99f6e4', '#d8b4fe', '#a5f3fc'][i % 3],
    dx1: rand(-50, 50), dy1: rand(-40, -10),
    dx2: rand(-40, 40), dy2: rand(-90, -40),
    dur: rand(8, 14), delay: rand(0, 9),
  })), []);
  const spores = useMemo(() => Array.from({ length: 16 }, () => ({
    x: rand(5, 95), size: rand(2, 4),
    dur: rand(7, 13), delay: rand(0, 10),
    dx: rand(-50, 50), travel: rand(0.3, 0.6),
  })), []);
  const rays = useMemo(() => [
    { x: 18, dur: 8, delay: 0 }, { x: 44, dur: 10, delay: 3 }, { x: 68, dur: 9, delay: 6 },
  ], []);
  return (
    <>
      <div className="enf-bg" />
      {rays.map((r, i) => (
        <div key={`r${i}`} className="enf-ray" style={{
          left: `${r.x}%`, '--dur': `${r.dur}s`, '--delay': `${r.delay}s`,
        }} />
      ))}
      {trunks.map((t, i) => (
        <div key={`t${i}`} className="enf-trunk" style={{
          left: `${t.x}%`, '--tw': `${t.tw}px`, '--th': `${t.th}%`, '--op': t.op,
        }} />
      ))}
      <div className="enf-canopy" />
      {shrooms.map((s, i) => (
        <div key={`s${i}`} className="enf-shroom" style={{ left: `${s.x}%`, bottom: `${s.b}%` }}>
          <div className="enf-cap" style={{
            '--cw': `${s.cw}px`, '--col': s.col,
            '--dur': `${s.dur}s`, '--delay': `${s.delay}s`,
          }} />
          <div className="enf-stem" style={{ '--cw': `${s.cw}px` }} />
        </div>
      ))}
      {wisps.map((w, i) => (
        <div key={`w${i}`} className="enf-wisp" style={{
          left: `${w.x}%`, top: `${w.y}%`,
          '--ws': `${w.ws}px`, '--col': w.col,
          '--dx1': `${w.dx1}px`, '--dy1': `${w.dy1}px`,
          '--dx2': `${w.dx2}px`, '--dy2': `${w.dy2}px`,
          '--dur': `${w.dur}s`, '--delay': `${w.delay}s`,
        }} />
      ))}
      {spores.map((s, i) => (
        <div key={`sp${i}`} className="enf-spore" style={{
          left: `${s.x}%`, width: s.size, height: s.size,
          '--dur': `${s.dur}s`, '--delay': `${s.delay}s`,
          '--dx': `${s.dx}px`, '--travel': `${s.travel * 60}vh`,
        }} />
      ))}
    </>
  );
}

// ─── Map animation id → component ────────────────────────────────────────
const ANIMATION_MAP = {
  // Common
  coralRush:  CoralRushLayer,
  mintFrost:  MintFrostLayer,
  roseQuartz: RoseQuartzLayer,
  solarFlare: SolarFlareLayer,   // Wave 70 — was unwired
  jadeStone:  JadeStoneLayer,    // Wave 70 — was unwired
  // Uncommon
  dusk:       DuskLayer,
  tidal:      TidalLayer,
  sunset:     SunsetLayer,
  arctic:     ArcticLayer,
  // Rare
  nebula:     NebulaLayer,
  ember:      EmberLayer,
  volcano:    VolcanoLayer,
  // Epic
  aurora:     AuroraLayer,
  cyberpunk:  CyberpunkLayer,
  galaxy:     GalaxyLayer,
  // Legendary
  prism:      PrismLayer,
  // ── Wave 2 collectible drop ──
  zenGarden:         ZenGardenLayer,        // common
  desertMirage:      DesertMirageLayer,     // uncommon
  mountainSummit:    MountainSummitLayer,   // uncommon
  abyss:             AbyssLayer,            // rare
  ancientTemple:     AncientTempleLayer,    // rare
  waterfall:         WaterfallLayer,        // rare
  stormChaser:       StormChaserLayer,      // epic
  lunarColony:       LunarColonyLayer,      // epic
  enchantedForest:   EnchantedForestLayer,  // epic
  underwaterKingdom: UnderwaterKingdomLayer, // legendary
  dragonsLair:       DragonsLairLayer,      // mythic
  // Legacy
  steel_usa:  SteelUsaLayer,
};

// ─── Main export ─────────────────────────────────────────────────────────
export default function ThemeAnimationLayer() {
  const { activeAnimation } = useTheme();
  const AnimComp = activeAnimation ? ANIMATION_MAP[activeAnimation] : null;

  if (!AnimComp) return null;

  // The wrapper provides:
  //   • fixed positioning at z-index -1 (behind every UI element)
  //   • pointer-events: none (clicks pass through)
  //   • overflow: hidden (scene paint can't bleed into scroll)
  //   • `.theme-scene` class — the `prefers-reduced-motion` rule in
  //     index.css keys off this so scene paint survives but motion
  //     stops for accessibility.
  //   • CSS `transition: opacity 1.2s` on `.anim-layer` (fade in/out)
  //
  // Why z-index: -1 (not 0)? A positioned element with z-index >= 0
  // paints AFTER static-positioned siblings in the same stacking
  // context — i.e. on top of cards/buttons. -1 paints between the
  // body's background and the static content, which is what we want.
  //
  // `key={activeAnimation}` forces a remount on theme swap so each
  // scene's RAND seeds (star positions, sparks, petals) reroll fresh.
  return (
    <div
      key={activeAnimation}
      className="theme-scene anim-layer on fixed inset-0 pointer-events-none overflow-hidden"
      style={{ zIndex: -1 }}
      aria-hidden="true"
    >
      <AnimComp />
    </div>
  );
}
