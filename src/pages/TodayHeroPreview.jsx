// src/pages/TodayHeroPreview.jsx
//
// A test bench for Today's hero carousel, so the trend draw can be watched
// on a real phone at the phone's own frame rate, and at 1/8 speed, in every
// data state (everything live at once, a strength and a weight trend, strength only, not enough yet,
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
import {
  duelGlance, warGlance, fuelGlance, questGlance, goalGlance, trainingPattern,
} from '@/lib/heroGlance';

const DAY_MS = 86_400_000;
const iso = (now, offset) => {
  const d = new Date(now.getTime() + offset * DAY_MS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const lift = (now, offset, name, weight, reps) => ({
  id: `${name}-${offset}`,
  date: iso(now, offset),
  // Saved in the evening, so the pattern slide has a usual time to report.
  created_at: `${iso(now, offset)}T18:${String(10 + (Math.abs(offset) % 40)).padStart(2, '0')}:00`,
  exercises: [{ name, sets: [{ weight, reps }] }],
});

const HOUR_MS = 3_600_000;
const quest = (id, label, target, progress, done, claimed) => ({
  id, quest_id: id, target, progress,
  completed_at: done ? 'x' : null, claimed_at: claimed ? 'x' : null,
  definition: { id, label },
});

// The rest of the carousel, built with the same pure builders the live hook
// uses, so the bench shows exactly what those builders produce.
export function sampleGlance(logs, now) {
  const later = new Date(Date.now());
  return {
    duel: duelGlance({
      id: 'd1', status: 'active', type: 'open', challenger_id: 'me', opponent_id: 'them',
      challenger_result: { volume: 14250 }, opponent_result: { volume: 12900 },
      expires_at: new Date(later.getTime() + 18 * HOUR_MS).toISOString(),
      opponent_name: 'marisol',
    }, 'me', later),
    war: warGlance({ crewId: 'c1', crewName: 'Iron Wolves', mine: 1840, theirs: 2015, endsAt: new Date(later.getTime() + 3 * 24 * HOUR_MS).toISOString() }, later),
    fuel: fuelGlance({
      calories: 1380, macros: { protein: 96, carbs: 140, fat: 41 },
      targets: { calories: 2450, protein_g: 165, carbs_g: 270, fat_g: 75 }, tracksFood: true,
    }),
    quests: questGlance([
      quest('log_meal', 'Log a meal', 1, 1, true, true),
      quest('drink_water_4', 'Drink 4 glasses of water', 4, 2, false, false),
      quest('workout_15min', 'Train for 15 minutes', 15, 0, false, false),
    ]),
    goal: goalGlance({
      goals: [
        { id: 'g1', status: 'active', title: 'Bench 225 x 5', goal_type: 'strength', exercise_name: 'Bench Press', target_weight: 225, target_reps: 5, created_date: iso(now, -60) },
        { id: 'g2', status: 'active', title: 'Squat 315', goal_type: 'strength', exercise_name: 'Squat', target_weight: 315, target_reps: 1, created_date: iso(now, -60) },
      ],
      logs,
    }),
    pattern: trainingPattern({ logs, now }),
  };
}

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
    case 'everything': { const logs = bench.reverse(); return { logs, bodyMetrics: weigh, glance: sampleGlance(logs, now) }; }
    case 'both': return { logs: bench.reverse(), bodyMetrics: weigh };
    case 'strength': return { logs: bench.reverse(), bodyMetrics: [] };
    case 'notyet': return { logs: [lift(now, -1, 'Squat', 185, 5), lift(now, -6, 'Squat', 180, 5)], bodyMetrics: [] };
    default: return { logs: [], bodyMetrics: [] };
  }
}

const SCENARIOS = [
  ['everything', 'Everything live'],
  ['both', 'Strength and weight'],
  ['strength', 'Strength only'],
  ['notyet', 'Two of three'],
  ['new', 'Brand new'],
];

export default function TodayHeroPreview() {
  const { t, tFallback } = useLanguage();
  const [id, setId] = useState('everything');
  const [slow, setSlow] = useState(false);
  const now = useMemo(() => { const d = new Date(); d.setHours(12, 0, 0, 0); return d; }, []);
  const data = useMemo(() => scenario(id, now), [id, now]);

  return (
    <div className="dark min-h-screen bg-background text-foreground px-4 py-6 flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <p className="text-label font-medium text-muted-foreground">Preview bench, sample data</p>
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
          glance={data.glance ?? null}
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
