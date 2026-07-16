// src/components/nutrition/CalorieTopBar.jsx
//
// "Calories left" status bar pinned at the top of the Nutrition page.
//
// Layout: the big number is the calories REMAINING (left side); the
// consumed / goal tally is small on the right. The progress bar reads like a
// battery/fuel gauge — it starts FULL at the day's reset and drains toward 0
// as the user eats. It never goes below empty; once the user crosses the goal
// the "left" figure just keeps counting into the negative.
//
// The fill is coloured (a soft) green → yellow → red by how much is left (hue
// scales with the remaining %), with tiny solid colour specks continuously
// falling top → bottom across the filled part.

import React from 'react';
import { motion } from 'framer-motion';
import { calculateDailyValues } from '@/lib/nutritionDefaults';

// Tiny specks scattered across the fill, each falling top→bottom on its own
// stagger so the stream is continuous. Positions/timings are derived
// deterministically from the index (no per-render randomness → stable motion).
const SPECKS = Array.from({ length: 28 }, (_, i) => ({
  left:   (i * 37) % 100,               // spread across the width
  size:   2 + (i % 3),                  // 2–4px solid dots
  dur:    2.2 + ((i * 7) % 18) / 10,    // 2.2–3.9s fall
  delay:  -(((i * 13) % 36) / 10),      // negative → already mid-fall on mount
  hueOff: ((i * 17) % 28) - 14,         // −14..+13 offset shade
}));

const SPECK_KEYFRAMES = `
@keyframes ctbFall {
  0%   { transform: translateY(-7px); opacity: 0; }
  20%  { opacity: 0.95; }
  80%  { opacity: 0.95; }
  100% { transform: translateY(24px); opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .ctb-speck { animation: none !important; opacity: 0.6 !important; }
}
`;

export default function CalorieTopBar({ entries = [], userProfile = {} }) {
  const consumed = entries.reduce((s, e) => s + (Number(e.calories) || 0), 0);
  const dv = calculateDailyValues(userProfile);
  const goal = Number(dv?.calories) || 2000;
  const remaining = Math.round(goal - consumed);
  const over = remaining < 0;

  // Remaining fraction of the goal, 0–100. This drives BOTH the bar width
  // (full → empty) and the colour hue. The bar bottoms out at 0 and never
  // shows negative width; the number keeps going negative on its own.
  const remainingPct = goal > 0 ? Math.max(0, Math.min((remaining / goal) * 100, 100)) : 0;

  // Battery hue: 120° (green) when full → 60° (yellow) at half → 0° (red) at
  // empty. Linear in the remaining %.
  const hue = Math.round((remainingPct / 100) * 120);
  // Softer, less saturated fill so the green isn't so heavy/neon.
  const fillGradient = `linear-gradient(180deg, hsl(${hue} 52% 50%), hsl(${hue} 56% 42%))`;

  return (
    <div className="mb-4 rounded-2xl bg-card border border-border p-4">
      <style>{SPECK_KEYFRAMES}</style>

      {/* Top row — big "left" on the left, small consumed/goal on the right */}
      <div className="flex items-end justify-between gap-3 mb-2.5">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className={`font-heading text-4xl font-bold leading-none tabular-nums ${over ? 'text-red-500' : 'text-foreground'}`}>
            {remaining.toLocaleString()}
          </span>
          <span className="text-sm font-semibold text-muted-foreground">left</span>
        </div>
        <span className="text-xs tabular-nums text-muted-foreground shrink-0 pb-0.5">
          {Math.round(consumed).toLocaleString()} / {goal.toLocaleString()} cal
        </span>
      </div>

      {/* Battery / lava-lamp gauge — drains from full toward empty */}
      <div className="relative h-5 w-full rounded-full bg-secondary overflow-hidden">
        <motion.div
          className="absolute inset-y-0 left-0 rounded-full overflow-hidden"
          style={{ background: fillGradient }}
          initial={{ width: '100%' }}
          animate={{ width: `${remainingPct}%` }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Tiny solid specks falling top → bottom across the fill */}
          {SPECKS.map((s, i) => (
            <span
              key={i}
              className="ctb-speck absolute rounded-full"
              style={{
                width: s.size,
                height: s.size,
                top: 0,
                left: `${s.left}%`,
                background: `hsl(${Math.max(0, Math.min(140, hue + s.hueOff))} 60% 74%)`,
                animation: `ctbFall ${s.dur}s linear ${s.delay}s infinite`,
                willChange: 'transform, opacity',
              }}
            />
          ))}
        </motion.div>
      </div>
    </div>
  );
}
