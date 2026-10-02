// src/pages/TodayHeroPreview.jsx
//
// A test bench for Today's hero carousel, so the trend draw can be watched
// on a real phone at the phone's own frame rate, and at 1/8 speed, in every
// data state (a strength and a weight trend, strength only, not enough yet,
// brand new). Your own Today on this deploy preview shows your real data;
// this page exists because one account can only ever be in one state.
//
// Only reachable on a Netlify deploy preview or localhost (see App.jsx);
// production never routes here. It renders the real HeroCard with SAMPLE
// logs, says so on screen, and writes nothing.

import React, { useMemo, useState } from 'react';
import { useLanguage } from '@/lib/LanguageContext';
import { HeroCard } from '@/pages/Dashboard';
import { TrendTimeScale } from '@/components/glance/TrendGraph';

const DAY_MS = 86_400_000;
const iso = (now, offset) => {
  const d = new Date(now.getTime() + offset * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const lift = (now, offset, name, weight, reps) => ({
  id: `${name}-${offset}`, date: iso(now, offset), exercises: [{ name, sets: [{ weight, reps }] }],
});

// Sample histories. Plausible numbers for an intermediate lifter; the point
// is the shape of each state, not the values.
function scenario(id, now) {
  const bench = [
    [-49, 165, 5], [-45, 165, 6], [-42, 170, 5], [-38, 170, 6], [-35, 175, 5], [-31, 175, 5],
    [-28, 180, 4], [-24, 175, 6], [-21, 180, 5], [-17, 185, 4], [-14, 185, 5], [-10, 185, 6],
    [-7, 190, 4], [-3, 190, 5], [-1, 195, 4],
  ].map(([o, w, r]) => lift(now, o, 'Bench Press', w, r));
  const weigh = [[-42, 186.4], [-35, 185.2], [-28, 184.6], [-21, 183.1], [-14, 182.8], [-7, 181.5], [0, 180.6]]
    .map(([o, w]) => ({ date: iso(now, o), weight_lbs: w }))
    .reverse();
  switch (id) {
    case 'both': return { logs: bench.reverse(), bodyMetrics: weigh };
    case 'strength': return { logs: bench.reverse(), bodyMetrics: [] };
    case 'notyet': return { logs: [lift(now, -1, 'Squat', 185, 5), lift(now, -6, 'Squat', 180, 5)], bodyMetrics: [] };
    default: return { logs: [], bodyMetrics: [] };
  }
}

const SCENARIOS = [
  ['both', 'Strength and weight'],
  ['strength', 'Strength only'],
  ['notyet', 'Two of three'],
  ['new', 'Brand new'],
];

export default function TodayHeroPreview() {
  const { t, tFallback } = useLanguage();
  const [id, setId] = useState('both');
  const [slow, setSlow] = useState(false);
  const now = useMemo(() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; }, []);
  const data = useMemo(() => scenario(id, now), [id, now]);

  return (
    <div className="dark min-h-screen bg-background text-foreground px-4 py-6 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-micro font-bold uppercase tracking-[0.04em] text-muted-foreground">Preview bench, sample data</p>
        <div className="flex flex-wrap gap-2">
          {SCENARIOS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setId(key)}
              className={`h-9 px-3 rounded-lg border text-label ${id === key ? 'border-primary text-foreground' : 'border-border text-muted-foreground'}`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSlow((s) => !s)}
            className={`h-9 px-3 rounded-lg border text-label ${slow ? 'border-primary text-foreground' : 'border-border text-muted-foreground'}`}
          >
            1/8 speed
          </button>
        </div>
      </div>

      <TrendTimeScale.Provider value={slow ? 8 : 1}>
        <HeroCard
          key={`${id}-${slow}`}
          streak={3}
          hasWorkedOutToday={false}
          daysSinceLast={id === 'new' ? null : 1}
          logs={data.logs}
          bodyMetrics={data.bodyMetrics}
          userProfile={{ training_days: [1, 3, 5] }}
          now={now}
          onPrimary={() => {}}
          t={t}
          tFallback={tFallback}
        />
      </TrendTimeScale.Provider>
    </div>
  );
}
