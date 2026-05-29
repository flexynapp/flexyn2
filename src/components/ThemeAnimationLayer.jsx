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

import { useMemo, useEffect, useRef } from 'react';
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
