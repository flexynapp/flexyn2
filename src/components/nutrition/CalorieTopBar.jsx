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
// The fill is coloured green → yellow → red by how much is left (hue scales
// with the remaining %), with blurred colour orbs drifting inside it for a
// slow lava-lamp motion.

import React from 'react';
import { motion } from 'framer-motion';
import { calculateDailyValues } from '@/lib/nutritionDefaults';

// Orbs that drift inside the fill for the lava-lamp effect. Sizes in px,
// positions in % of the fill; each rides one of three drift keyframes at its
// own duration/offset so the motion never looks synchronised.
const ORBS = [
  { size: 30, top: '8%',   left: '12%', anim: 'ctbLavaA', dur: 5.5, delay: '0s',    hue: -10 },
  { size: 38, top: '30%',  left: '48%', anim: 'ctbLavaB', dur: 7.2, delay: '-1.8s', hue: 8   },
  { size: 24, top: '-8%',  left: '74%', anim: 'ctbLavaC', dur: 4.9, delay: '-0.9s', hue: -6  },
  { size: 28, top: '34%',  left: '30%', anim: 'ctbLavaB', dur: 8.1, delay: '-3.4s', hue: 12  },
  { size: 22, top: '18%',  left: '88%', anim: 'ctbLavaA', dur: 6.3, delay: '-2.2s', hue: 4   },
];

const LAVA_KEYFRAMES = `
@keyframes ctbLavaA {
  0%   { transform: translate(0, 0) scale(1); }
  50%  { transform: translate(140%, -18%) scale(1.28); }
  100% { transform: translate(0, 0) scale(1); }
}
@keyframes ctbLavaB {
  0%   { transform: translate(0, 10%) scale(1.1); }
  50%  { transform: translate(-120%, -12%) scale(0.85); }
  100% { transform: translate(0, 10%) scale(1.1); }
}
@keyframes ctbLavaC {
  0%   { transform: translate(0, -6%) scale(0.9); }
  50%  { transform: translate(90%, 20%) scale(1.2); }
  100% { transform: translate(0, -6%) scale(0.9); }
}
@media (prefers-reduced-motion: reduce) {
  .ctb-orb { animation: none !important; }
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
  const fillGradient = `linear-gradient(180deg, hsl(${hue} 88% 56%), hsl(${hue} 82% 45%))`;

  return (
    <div className="mb-4 rounded-2xl bg-card border border-border p-4">
      <style>{LAVA_KEYFRAMES}</style>

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
          {/* Drifting colour orbs */}
          {ORBS.map((o, i) => (
            <span
              key={i}
              className="ctb-orb absolute rounded-full"
              style={{
                width: o.size,
                height: o.size,
                top: o.top,
                left: o.left,
                background: `hsl(${Math.max(0, Math.min(140, hue + o.hue))} 95% 70% / 0.6)`,
                filter: 'blur(5px)',
                animation: `${o.anim} ${o.dur}s ease-in-out ${o.delay} infinite`,
                willChange: 'transform',
              }}
            />
          ))}
          {/* Soft top sheen for a glassy battery look */}
          <span className="absolute inset-x-0 top-0 h-1/2 bg-white/20 rounded-full pointer-events-none" />
        </motion.div>
      </div>
    </div>
  );
}
