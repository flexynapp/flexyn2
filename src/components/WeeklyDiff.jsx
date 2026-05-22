// src/components/WeeklyDiff.jsx
//
// Tiny "↑ 12% vs last week" indicator next to Dashboard stats. Reads
// the current + prior period value and renders the appropriate
// chevron + percentage + color. Strava / Whoop / Oura have these
// universally — they're the difference between "numbers" and "story."
//
// Tap reveals the actual prior-period value as an inline note.
//
// USAGE
//
//   <WeeklyDiff
//     current={12}
//     previous={9}
//     direction="higherIsBetter"  // 'higherIsBetter' | 'lowerIsBetter' | 'neutral'
//   />
//
// EDGE CASES
//
//   • previous === 0 + current > 0 → show "+X new" instead of "↑ ∞%"
//   • previous === 0 + current === 0 → render nothing (no signal)
//   • Diff under 5% → muted (avoid fixating on noise)
//   • current === previous → render nothing
//   • Either value missing → render nothing

import { useState } from 'react';
import { ArrowUp, ArrowDown } from 'lucide-react';

const NOISE_THRESHOLD_PCT = 5;

export default function WeeklyDiff({
  current,
  previous,
  direction = 'higherIsBetter',
  className = '',
}) {
  const [revealing, setRevealing] = useState(false);

  if (current == null || previous == null) return null;
  if (current === previous) return null;

  // Cold start — no prior-week data → "+X new" framing.
  if (previous === 0) {
    if (current === 0) return null;
    return (
      <button
        type="button"
        onClick={() => setRevealing((r) => !r)}
        className={`inline-flex items-center gap-0.5 text-[10px] font-semibold text-primary ${className}`}
      >
        <span>+{current} new</span>
      </button>
    );
  }

  const pctChange = ((current - previous) / previous) * 100;
  const delta = current - previous;
  const isUp = delta > 0;
  const isNoise = Math.abs(pctChange) < NOISE_THRESHOLD_PCT;

  // Color: per direction-meaning. "lowerIsBetter" flips (rest days,
  // missed days, screen time). "neutral" stays muted regardless.
  let color = 'text-muted-foreground';
  if (!isNoise && direction !== 'neutral') {
    const isGood = direction === 'higherIsBetter' ? isUp : !isUp;
    color = isGood ? 'text-emerald-500' : 'text-rose-500';
  }

  const Arrow = isUp ? ArrowUp : ArrowDown;

  return (
    <button
      type="button"
      onClick={() => setRevealing((r) => !r)}
      className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${color} ${className}`}
      aria-label={`${isUp ? 'Up' : 'Down'} ${Math.abs(Math.round(pctChange))} percent vs last week`}
    >
      <Arrow className="w-2.5 h-2.5" strokeWidth={3} />
      <span>{Math.abs(Math.round(pctChange))}%</span>
      {revealing && (
        <span className="text-muted-foreground ml-1 font-normal">
          (was {previous})
        </span>
      )}
    </button>
  );
}
