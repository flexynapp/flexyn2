// src/components/dashboard/ChartWidgets.jsx
//
// The recharts-backed dashboard widgets, split out of WidgetRenderer so
// recharts (vendor-charts, ~274 KB) is NOT pulled into the eager Dashboard
// chunk. WidgetRenderer React.lazy()-imports these, so the chart library only
// loads when a user actually has a chart widget on their dashboard.
//
// Self-contained: these two widgets only depend on lib helpers + UI primitives
// (no shared local helpers from WidgetRenderer), so the split is clean.

import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, Target } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { muscleKey, getExerciseDisplay } from '@/lib/exerciseTranslations';
import { fromLbs } from '@/lib/weightUnit';
import { rollUpToRegions, regionColor } from '@/lib/muscleRegions';

// Exercise Trends Widget
export function ExerciseTrendsWidget({ logs, isLoading }) {
  const { t, tFallback, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const data = useMemo(() => {
    if (!logs?.length) return [];

    const exerciseMap = {};
    logs.forEach(log => {
      log.exercises?.forEach(ex => {
        if (!exerciseMap[ex.name]) {
          exerciseMap[ex.name] = { name: ex.name, maxWeightLbs: 0, maxReps: 0 };
        }
        ex.sets?.forEach(set => {
          if (set.weight) exerciseMap[ex.name].maxWeightLbs = Math.max(exerciseMap[ex.name].maxWeightLbs, set.weight);
          if (set.reps) exerciseMap[ex.name].maxReps = Math.max(exerciseMap[ex.name].maxReps, set.reps);
        });
      });
    });

    return Object.values(exerciseMap)
      .slice(0, 5)
      .sort((a, b) => b.maxWeightLbs - a.maxWeightLbs)
      .map(e => ({ ...e, maxWeightDisplay: fromLbs(e.maxWeightLbs, weightUnit), displayName: getExerciseDisplay(e, language) }));
  }, [logs, weightUnit, language]);

  return (
    <Card className="p-4 col-span-1 md:col-span-2">
      <h4 className="font-semibold text-sm mb-3 flex items-center gap-2">
        <TrendingUp className="w-4 h-4" /> {t('progress.exerciseTrends')}
      </h4>
      {isLoading ? (
        <Skeleton className="h-64" />
      ) : data.length === 0 ? (
        <p className="text-xs text-muted-foreground py-8 text-center">{t('progress.noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={200} key={weightUnit}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="displayName" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} />
            <Bar dataKey="maxWeightDisplay" fill="hsl(var(--primary))" name={tFallback('workout.weightWithUnit', 'Weight ({unit})', { unit: weightUnit })} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

// Region names. `other` is Core plus whole-body and cardio work — the
// label says so rather than saying "Other", because a lifter reading
// "Other" next to Push/Pull/Legs would reasonably wonder what it hid.
const REGION_FALLBACK = { push: 'Push', pull: 'Pull', legs: 'Legs', other: 'Core & other' };

// Muscle Groups Widget
export function MuscleGroupsWidget({ logs, isLoading }) {
  const { t, tFallback } = useLanguage();
  const regionLabel = (r) => tFallback(`regions.${r}`, REGION_FALLBACK[r] || r);
  // Rolled up to REGIONS, not left as individual muscles, and the reason
  // is the colour budget — see src/lib/muscleRegions.js for the
  // measurements. Three hues is the ceiling a validated categorical
  // palette can carry here, so twelve muscles could never each have one.
  //
  // Two bugs died with the rollup:
  //
  //   • `.slice(0, 6)` ran on INSERTION order, not size, so it kept the
  //     first six groups it happened to encounter and silently dropped
  //     the rest — including, on a varied week, bigger ones than the six
  //     it kept. A chart claiming to show your distribution was omitting
  //     part of it with nothing on screen saying so. Four regions cannot
  //     overflow, so nothing is dropped now.
  //   • colour came from `COLORS[hash(name) % COLORS.length]`. That is
  //     cycling, which a categorical palette must never do — and with
  //     six slots against six wedges the chance of no collision is
  //     6!/6⁶ ≈ 1.5%, so ~98% of the time two wedges shared a colour.
  //     Worse, slot 0 was `--primary` and slot 1 `--chart-1`, which are
  //     the SAME value in both themes, so it was really five slots.
  const muscleData = useMemo(() => {
    if (!logs?.length) return [];
    const byKey = {};
    logs.forEach(log => {
      log.exercises?.forEach(ex => {
        const muscles = ex.muscle_groups || (ex.muscle_group ? [ex.muscle_group] : []);
        muscles.forEach(m => {
          if (!m) return;
          const k = muscleKey(m);
          byKey[k] = (byKey[k] || 0) + 1;
        });
      });
    });
    return rollUpToRegions(byKey);
  }, [logs]);

  return (
    <Card className="p-4">
      <h4 className="font-semibold text-sm flex items-center gap-2 mb-3">
        <Target className="w-4 h-4" /> {t('widgets.muscleGroups')}
      </h4>
      {isLoading ? (
        <Skeleton className="h-32" />
      ) : muscleData.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">{t('progress.noData')}</p>
      ) : (
        <ResponsiveContainer width="100%" height={120}>
          <PieChart>
            <Pie
              data={muscleData}
              cx="50%"
              cy="50%"
              innerRadius={30}
              outerRadius={50}
              paddingAngle={2}
              dataKey="value"
            >
              {/* Colour follows the REGION — a stable property of the
                  muscle — never the wedge's rank or its position in the
                  list. Removing a log cannot repaint the survivors. */}
              {muscleData.map((entry) => (
                <Cell
                  key={`cell-${entry.region}`}
                  fill={regionColor(entry.region)}
                  stroke="hsl(var(--card))"
                  strokeWidth={2}
                />
              ))}
            </Pie>
            {/* `var(--card)` was not a colour: these variables hold raw
                HSL triplets ("210 18% 12%"), so the tooltip has been
                rendering with no background and no border since it was
                written. It needs the hsl() wrapper like everything else. */}
            <Tooltip
              contentStyle={{
                background: 'hsl(var(--card))',
                border: '1px solid hsl(var(--border))',
                borderRadius: '8px',
                fontSize: '12px',
              }}
              formatter={(value, _n, entry) => [value, regionLabel(entry?.payload?.region)]}
            />
          </PieChart>
        </ResponsiveContainer>
      )}
      {/* The named chips are not decoration — they are the secondary
          encoding the palette's light-mode contrast WARN requires, and
          they are what keeps identity from resting on colour alone. */}
      <div className="mt-2 flex flex-wrap gap-1">
        {muscleData.map(m => (
          <span
            key={m.region}
            className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-sm bg-secondary text-secondary-foreground"
          >
            <span
              className="w-2 h-2 rounded-full shrink-0"
              style={{ background: regionColor(m.region) }}
              aria-hidden="true"
            />
            {regionLabel(m.region)} ({m.value})
          </span>
        ))}
      </div>
    </Card>
  );
}
