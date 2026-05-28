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

// ─── Mint Frost — pine forest horizon + drifting mist ───────────────────
function MintFrostLayer() {
  return (
    <>
      <div className="mint-bg" />
      <div className="mint-pines" />
      <div className="mint-mist a" />
      <div className="mint-mist b" />
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

// ─── Tidal Force — beach + crashing waves + gulls ───────────────────────
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
    </>
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

// ─── Nebula — gas-giant planet + drifting cosmic clouds + dense stars
// Wave 69: added the planet silhouette at top-left and three layered
// drifting nebula clouds (pink/blue/violet) so this reads as a proper
// nebula and is visually distinct from Galactic's ringed-planet scene.
function NebulaLayer() {
  const far = useMemo(() => Array.from({ length: 90 }, () => ({
    x: rand(0, 100), y: rand(0, 100),
    size: rand(0.5, 1.6),
    op: rand(0.2, 0.55), opHigh: rand(0.8, 1),
    dur: rand(3, 8),
  })), []);
  const near = useMemo(() => Array.from({ length: 14 }, () => ({
    x: rand(0, 100), y: rand(0, 100),
    size: rand(1.6, 4),
    dur: rand(2, 5),
    dx: rand(-40, 40),
  })), []);
  return (
    <>
      <div className="nebula-grad" />
      <div className="nebula-cloud-a" />
      <div className="nebula-cloud-b" />
      <div className="nebula-cloud-c" />
      <div className="nebula-planet" />
      {far.map((s, i) => (
        <div key={i} className="star twinkle"
          style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: s.size, height: s.size,
            '--opacity-low': s.op, '--opacity-high': s.opHigh,
            '--dur': `${s.dur}s`,
          }}
        />
      ))}
      {near.map((s, i) => (
        <div key={`n${i}`} className="star near"
          style={{
            left: `${s.x}%`, top: `${s.y}%`,
            width: s.size, height: s.size,
            '--tint': '#e9d5ff',
            '--dur': `${s.dur}s`, '--dx': `${s.dx}px`,
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

// ─── Volcanic — cone silhouette + crater glow + smoke + magma sparks ────
function VolcanoLayer() {
  const sparks = useMemo(() => Array.from({ length: 30 }, () => ({
    x: rand(35, 65), size: rand(2, 5),
    dur: rand(2.5, 5), delay: rand(0, 5),
    dx: rand(-40, 40), travel: rand(0.4, 0.7),
    color: ['#fbbf24', '#f97316', '#ef4444', '#fde047'][Math.floor(rand(0, 4))],
  })), []);
  return (
    <>
      <div className="volcano-sky" />
      <div className="volcano-smoke" />
      <div className="volcano-cone" />
      <div className="volcano-crater" />
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

// ─── Cyberpunk — neon skyline + blinking windows + flyers + scanlines ───
function CyberpunkLayer() {
  const windows = useMemo(() => Array.from({ length: 80 }, () => ({
    x: rand(2, 98),
    y: rand(58, 95),
    dur: rand(3, 7),
    delay: rand(0, 6),
    color: ['#06b6d4', '#e879f9', '#f0abfc', '#67e8f9'][Math.floor(rand(0, 4))],
  })), []);
  const flyers = useMemo(() => Array.from({ length: 3 }, (_, i) => ({
    top: 18 + i * 12,
    dur: rand(10, 20),
    delay: i * 5,
  })), []);
  return (
    <>
      <div className="cyber-sky" />
      <div className="cyber-grid" />
      <div className="cyber-skyline" />
      <div className="cyber-edge l" />
      <div className="cyber-edge r" />
      {windows.map((w, i) => (
        <div key={i} className="cyber-window"
          style={{
            left: `${w.x}%`, top: `${w.y}%`,
            color: w.color,
            background: w.color,
            '--dur': `${w.dur}s`, '--delay': `${w.delay}s`,
          }}
        />
      ))}
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
  return (
    <>
      <div className="galaxy-grad" />
      <div className="galaxy-milky" />
      <div className="galaxy-spiral" />
      <div className="galaxy-spiral b" />
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

// ─── Prismatic — rainbow rays + pulsing core + halo + popping particles
// + JS-driven hue cycle. Wave 69: redesigned from a barely-visible
// conic tint into a proper chroma show — 12 rotating colored beams
// radiating from center, a bright pulsing core, and 50 burst particles.
function PrismLayer() {
  const hueRef = useRef(0);
  useEffect(() => {
    const root = document.documentElement;
    const tick = () => {
      hueRef.current = (hueRef.current + 0.3) % 360;
      const h = Math.round(hueRef.current);
      root.style.setProperty('--primary', `${h} 85% 60%`);
      root.style.setProperty('--ring',    `${h} 85% 60%`);
      root.style.setProperty('--sidebar-primary', `${h} 85% 60%`);
      root.style.setProperty('--sidebar-ring',    `${h} 85% 60%`);
    };
    const id = setInterval(tick, 32);
    return () => clearInterval(id);
  }, []);
  const particles = useMemo(() => Array.from({ length: 50 }, () => ({
    x: rand(0, 100), y: rand(0, 100),
    size: rand(1, 5), dur: rand(1.5, 4.5), delay: rand(0, 4),
  })), []);
  // Rainbow rays radiating out from center — each is a rotating beam.
  const rays = useMemo(() => {
    const colors = [
      'rgba(244,63,94,0.55)',
      'rgba(251,146,60,0.55)',
      'rgba(250,204,21,0.55)',
      'rgba(34,197,94,0.55)',
      'rgba(59,130,246,0.55)',
      'rgba(168,85,247,0.55)',
    ];
    return Array.from({ length: 12 }, (_, i) => ({
      rot: i * 30,
      color: colors[i % colors.length],
      dur: rand(4, 7),
      delay: rand(0, 4),
    }));
  }, []);
  return (
    <>
      <div className="prism-halo" />
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
