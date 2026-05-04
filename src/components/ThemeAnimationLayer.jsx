// src/components/ThemeAnimationLayer.jsx
// Renders fullscreen animated overlays for epic/legendary loot themes.
// All layers are pointer-events-none and sit at z-index 0 (behind UI content).

import { useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from '@/lib/ThemeContext';

// ─── Star field (nebula) ──────────────────────────────────────────────────────
function NebulaBg() {
  const stars = useMemo(() =>
    Array.from({ length: 60 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2.5 + 0.8,
      opacity: Math.random() * 0.5 + 0.15,
      driftX: (Math.random() - 0.5) * 4,
      driftY: (Math.random() - 0.5) * 4,
      duration: Math.random() * 14 + 10,
    })),
  []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {/* Deep purple radial bg tint */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 120% 80% at 50% 0%, rgba(88,28,135,0.18), transparent 70%)' }}
      />
      {stars.map(s => (
        <motion.div
          key={s.id}
          className="absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, opacity: s.opacity }}
          animate={{
            x: [0, s.driftX * 10, 0],
            y: [0, s.driftY * 10, 0],
            opacity: [s.opacity, s.opacity * 0.4, s.opacity],
          }}
          transition={{ duration: s.duration, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

// ─── Rising embers (ember) ────────────────────────────────────────────────────
function EmberBg() {
  const sparks = useMemo(() =>
    Array.from({ length: 22 }, (_, i) => ({
      id: i,
      startX: Math.random() < 0.5 ? Math.random() * 20 : 80 + Math.random() * 20, // left or right edge
      size: Math.random() * 4 + 2,
      opacity: Math.random() * 0.6 + 0.2,
      duration: Math.random() * 4 + 3,
      delay: Math.random() * 5,
      drift: (Math.random() - 0.5) * 60,
    })),
  []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {/* Edge glow */}
      <div className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 60% 40% at 0% 100%, rgba(239,68,68,0.12), transparent 60%), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(239,68,68,0.12), transparent 60%)' }}
      />
      {sparks.map(s => (
        <motion.div
          key={s.id}
          className="absolute rounded-full"
          style={{
            left: `${s.startX}%`,
            bottom: 0,
            width: s.size,
            height: s.size,
            background: 'radial-gradient(circle, #fbbf24, #ef4444)',
            opacity: 0,
          }}
          animate={{
            y: [0, -(window.innerHeight * 0.6)],
            x: [0, s.drift],
            opacity: [0, s.opacity, 0],
            scale: [1, 0.3],
          }}
          transition={{ duration: s.duration, repeat: Infinity, delay: s.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

// ─── Aurora borealis ──────────────────────────────────────────────────────────
function AuroraBg() {
  const bands = [
    { color: 'rgba(45,212,191,0.22)', delay: 0,   duration: 9  },
    { color: 'rgba(167,139,250,0.18)', delay: 3,   duration: 12 },
    { color: 'rgba(52,211,153,0.16)',  delay: 6,   duration: 10 },
  ];

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {bands.map((band, i) => (
        <motion.div
          key={i}
          className="absolute left-0 right-0"
          style={{
            top: `${i * 12}%`,
            height: '35%',
            background: `linear-gradient(180deg, transparent, ${band.color}, transparent)`,
            filter: 'blur(24px)',
          }}
          animate={{
            scaleX: [1, 1.15, 0.92, 1],
            scaleY: [1, 1.08, 0.96, 1],
            opacity: [0.6, 1, 0.7, 0.6],
            y: [0, 18, -10, 0],
          }}
          transition={{ duration: band.duration, repeat: Infinity, delay: band.delay, ease: 'easeInOut' }}
        />
      ))}
      {/* Faint star field behind the bands */}
      {Array.from({ length: 30 }, (_, i) => ({
        id: i, x: Math.random() * 100, y: Math.random() * 100,
        size: Math.random() * 1.5 + 0.5, dur: Math.random() * 4 + 2,
      })).map(s => (
        <motion.div key={s.id} className="absolute rounded-full bg-white"
          style={{ left: `${s.x}%`, top: `${s.y}%`, width: s.size, height: s.size, opacity: 0.2 }}
          animate={{ opacity: [0.1, 0.4, 0.1] }}
          transition={{ duration: s.dur, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

// ─── Cyberpunk scanlines + edge glows ─────────────────────────────────────────
function CyberpunkBg() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {/* Left edge neon glow */}
      <div className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: 'linear-gradient(to bottom, #06b6d4, #e879f9, #06b6d4)', opacity: 0.7 }}
      />
      {/* Right edge glow */}
      <div className="absolute right-0 top-0 bottom-0 w-1"
        style={{ background: 'linear-gradient(to bottom, #e879f9, #06b6d4, #e879f9)', opacity: 0.7 }}
      />
      {/* Edge ambient glow */}
      <div className="absolute inset-0"
        style={{ background: 'linear-gradient(to right, rgba(6,182,212,0.07), transparent 18%, transparent 82%, rgba(232,121,249,0.07))' }}
      />
      {/* Scanline */}
      <motion.div
        className="absolute left-0 right-0 h-px"
        style={{ background: 'linear-gradient(to right, transparent, rgba(6,182,212,0.55), rgba(232,121,249,0.55), transparent)' }}
        animate={{ top: ['-2%', '102%'] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear', repeatDelay: 1.5 }}
      />
      {/* Secondary faster scanline */}
      <motion.div
        className="absolute left-0 right-0 h-px"
        style={{ background: 'linear-gradient(to right, transparent, rgba(232,121,249,0.35), rgba(6,182,212,0.35), transparent)' }}
        animate={{ top: ['-2%', '102%'] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear', repeatDelay: 1.5, delay: 3 }}
      />
    </div>
  );
}

// ─── Dusk: slow warm gradient edge wash ───────────────────────────────────────
function DuskBg() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      <motion.div
        className="absolute inset-0"
        animate={{
          background: [
            'radial-gradient(ellipse 100% 60% at 100% 100%, rgba(249,115,22,0.12), transparent 65%)',
            'radial-gradient(ellipse 100% 60% at 100% 100%, rgba(225,29,72,0.12), transparent 65%)',
            'radial-gradient(ellipse 100% 60% at 100% 100%, rgba(249,115,22,0.12), transparent 65%)',
          ],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
    </div>
  );
}

// ─── Tidal: wave shimmer ──────────────────────────────────────────────────────
function TidalBg() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {[0, 1, 2].map(i => (
        <motion.div
          key={i}
          className="absolute left-0 right-0"
          style={{
            bottom: `${i * 8}%`,
            height: '12%',
            background: 'linear-gradient(to top, rgba(14,165,233,0.1), transparent)',
            filter: 'blur(8px)',
          }}
          animate={{ scaleY: [1, 1.4, 1], opacity: [0.4, 0.8, 0.4] }}
          transition={{ duration: 4 + i * 1.5, repeat: Infinity, ease: 'easeInOut', delay: i * 1.2 }}
        />
      ))}
    </div>
  );
}

// ─── Prismatic: cycling primary hue via JS ────────────────────────────────────
function PrismaticBg() {
  const hueRef = useRef(0);

  useEffect(() => {
    const root = document.documentElement;
    const tick = () => {
      hueRef.current = (hueRef.current + 0.3) % 360;
      const h = hueRef.current;
      root.style.setProperty('--primary', `${Math.round(h)} 85% 60%`);
      root.style.setProperty('--ring', `${Math.round(h)} 85% 60%`);
      root.style.setProperty('--sidebar-primary', `${Math.round(h)} 85% 60%`);
      root.style.setProperty('--sidebar-ring', `${Math.round(h)} 85% 60%`);
    };
    const id = setInterval(tick, 32); // ~30fps update
    return () => {
      clearInterval(id);
      // Restore will be handled by ThemeContext when theme changes
    };
  }, []);

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden" style={{ zIndex: 0 }}>
      {/* Particle burst overlay */}
      {Array.from({ length: 20 }, (_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        size: Math.random() * 3 + 1,
        dur: Math.random() * 3 + 1.5,
        delay: Math.random() * 4,
      })).map(p => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            background: 'white',
            opacity: 0,
          }}
          animate={{ opacity: [0, 0.7, 0], scale: [0.5, 1.8, 0.5] }}
          transition={{ duration: p.dur, repeat: Infinity, delay: p.delay, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

// ─── Map animation id → component ────────────────────────────────────────────
const ANIMATION_MAP = {
  nebula:    NebulaBg,
  ember:     EmberBg,
  aurora:    AuroraBg,
  cyberpunk: CyberpunkBg,
  dusk:      DuskBg,
  tidal:     TidalBg,
  prism:     PrismaticBg,
};

// ─── Main export ──────────────────────────────────────────────────────────────
export default function ThemeAnimationLayer() {
  const { activeAnimation } = useTheme();
  const AnimComp = activeAnimation ? ANIMATION_MAP[activeAnimation] : null;

  return (
    <AnimatePresence>
      {AnimComp && (
        <motion.div
          key={activeAnimation}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.2 }}
        >
          <AnimComp />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
