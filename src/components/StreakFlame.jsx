// src/components/StreakFlame.jsx
//
// Streak flame badge — visual reward that scales with milestones.
// Duolingo invented this pattern; it's the single biggest reason their
// app is sticky. The flame becomes a status symbol users want to protect.
//
// Tier thresholds:
//   1-6 days     standard flame, no decoration
//   7-29 days    flame with orange glow halo
//   30-99 days   flame with stronger glow + gold outline ring
//   100-364 days flame with pulsing animation + gold ring + sparkle overlay
//   365+ days    brightest gold ring + persistent sparkles (anniversary)
//
// The flame was the 🔥 emoji. Streak-as-flame is the right metaphor (and
// the reason this pattern works), but the emoji couldn't take the brand
// colour, ignored the surrounding font weight, and rendered as a different
// picture on every OS — Apple's, Google's and Samsung's flames don't even
// share a silhouette, so the "status symbol" looked like a different symbol
// per device. Lucide's Flame inherits currentColor, so it now goes gold
// with the tier instead of being a fixed picture beside gold chrome.
//
// All animations respect prefers-reduced-motion. Component is purely
// presentational — pass `days` and it does the rest. If `days <= 0` it
// renders nothing (no broken-streak greyed-out variant; that's a
// product decision for the consumer to make).

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';

function tierForDays(days) {
  if (days >= 365) return 4;
  if (days >= 100) return 3;
  if (days >= 30)  return 2;
  if (days >= 7)   return 1;
  return 0;
}

export default function StreakFlame({ days = 0, size = 16, className = '' }) {
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mq) return;
    setReducedMotion(mq.matches);
    const handler = (e) => setReducedMotion(e.matches);
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  if (days <= 0) return null;

  const tier = tierForDays(days);

  // Tier-specific styles. Glow is a box-shadow tinted to flame orange.
  // Outline rings are emoji-positioned via a pseudo-circle behind.
  const glow = {
    0: '',
    1: '0 0 6px rgba(251,146,60,0.45)',
    2: '0 0 10px rgba(251,146,60,0.6)',
    3: '0 0 14px rgba(251,191,36,0.75)',
    4: '0 0 18px rgba(251,191,36,0.9), 0 0 28px rgba(244,114,182,0.5)',
  }[tier];

  const ring = tier >= 2 ? {
    border: tier >= 4
      ? '1.5px solid transparent'
      : '1px solid rgba(251,191,36,0.7)',
    borderRadius: '50%',
    padding: '2px',
    // The 365-day ring was gold -> pink -> blue -> gold. Pink and blue are
    // outside the colour budget, and a rainbow on the app's rarest badge
    // read as generic rather than special. It's the brand gold sweep now —
    // the same gold as the hero CTA, which is what "this is the top tier"
    // should look like here.
    background: tier >= 4
      ? 'linear-gradient(135deg, #fde68a, #fbbf24, #f59e0b, #fde68a) border-box'
      : 'transparent',
    backgroundClip: tier >= 4 ? 'padding-box, border-box' : undefined,
  } : {};

  // Pulse at tier 3+; sparkles at tier 3+.
  const pulse = !reducedMotion && tier >= 3
    ? { scale: [1, 1.05, 1] }
    : undefined;

  return (
    <span
      className={`inline-flex items-center justify-center align-middle relative ${className}`}
      style={{ width: size + 6, height: size + 6, ...ring }}
      aria-label={`${days}-day streak`}
    >
      <motion.span
        animate={pulse}
        transition={pulse ? { duration: 2, repeat: Infinity, ease: 'easeInOut' } : undefined}
        className="inline-flex text-primary"
        style={{ lineHeight: 1, filter: glow ? `drop-shadow(${glow})` : undefined }}
      >
        <Flame width={size} height={size} strokeWidth={2.25} fill="currentColor" aria-hidden="true" />
      </motion.span>
      {tier >= 3 && !reducedMotion && (
        <>
          {/* Tiny sparkle overlay — three stars fading in/out at random offsets.
              Pure decoration; positioned absolutely so they don't push layout. */}
          <Sparkle x={-4}  y={-2}  delay={0}   />
          <Sparkle x={size - 2} y={2}  delay={0.7} />
          <Sparkle x={size / 2 - 4} y={size + 2} delay={1.4} />
        </>
      )}
    </span>
  );
}

function Sparkle({ x, y, delay }) {
  return (
    <motion.span
      aria-hidden="true"
      className="absolute pointer-events-none text-micro leading-none select-none"
      style={{ left: x, top: y, color: '#fbbf24' }}
      animate={{ opacity: [0, 1, 0], scale: [0.5, 1, 0.5] }}
      transition={{ duration: 1.5, repeat: Infinity, delay, ease: 'easeInOut' }}
    >
      ✦
    </motion.span>
  );
}
