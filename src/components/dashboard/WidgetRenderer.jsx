import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, Zap, Trophy, Target, Clock, Flame, ListOrdered } from 'lucide-react';
import { subDays, formatDistanceToNowStrict } from 'date-fns';
import StatsSlideshow from './StatsSlideshow';
import JournalWidget from './JournalWidget';
import ErrorBoundary from '@/components/ErrorBoundary';
import StreakFlame from '@/components/StreakFlame';
import { useLanguage } from '@/lib/LanguageContext';
import { useAuth } from '@/lib/AuthContext';
import { muscleKey, getExerciseDisplay } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { parseLocalDate } from '@/lib/dateUtils';
import { fromLbs, formatWeight } from '@/lib/weightUnit';
import { computeStrengthGoalProgress } from '@/lib/goalProgress';

// Local YYYY-MM-DD key (not toISOString, which is UTC and can shift the day).
const localDayKey = (dt) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

// Small stat tile used by the Last Workout widget.
function MiniStat({ label, value }) {
  return (
    <div className="rounded-lg bg-secondary/50 p-2 text-center">
      <p className="font-heading font-bold text-lg tabular-nums leading-none">{value}</p>
      <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wide">{label}</p>
    </div>
  );
}

// Exercise Trends Widget
function ExerciseTrendsWidget({ logs, isLoading }) {
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

// Weekly Volume Widget
function WeeklyVolumeWidget({ logs, isLoading }) {
  const { t } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const totalVolume = useMemo(() => {
    // subDays is DST-safe — `now - 7*24*60*60*1000` is off by an hour
    // around DST transitions and would silently exclude or include
    // workouts on the boundary day.
    const weekAgo = subDays(new Date(), 7);

    return logs
      ?.filter(log => {
        const d = parseLocalDate(log.date);
        return d && d >= weekAgo;
      })
      .reduce((sum, log) => {
        return sum + (log.exercises?.reduce((exSum, ex) => {
          return exSum + (ex.sets?.reduce((setSum, set) => {
            return setSum + ((set.weight || 0) * (set.reps || 0));
          }, 0) || 0);
        }, 0) || 0);
      }, 0) || 0;
  }, [logs]);

  return (
    <Card className="p-4">
      <h4 className="font-semibold text-sm flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4" /> {t('widgets.weeklyVolume')}
      </h4>
      {isLoading ? (
        <Skeleton className="h-20" />
      ) : (
        <motion.p
          className="font-heading text-3xl font-bold"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          {formatWeight(totalVolume, weightUnit)}
        </motion.p>
      )}
    </Card>
  );
}

// Personal Bests Widget
function PersonalBestsWidget({ logs, isLoading }) {
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const pbs = useMemo(() => {
    if (!logs?.length) return [];
    
    const exerciseMap = {};
    logs.forEach(log => {
      log.exercises?.forEach(ex => {
        if (!exerciseMap[ex.name]) {
          exerciseMap[ex.name] = { name: ex.name, weight: 0, reps: 0 };
        }
        ex.sets?.forEach(set => {
          if (set.weight) exerciseMap[ex.name].weight = Math.max(exerciseMap[ex.name].weight, set.weight);
          if (set.reps) exerciseMap[ex.name].reps = Math.max(exerciseMap[ex.name].reps, set.reps);
        });
      });
    });

    return Object.values(exerciseMap).slice(0, 4).sort((a, b) => b.weight - a.weight);
  }, [logs]);

  return (
    <Card className="p-4 col-span-1 md:col-span-2">
      <h4 className="font-semibold text-sm flex items-center gap-2 mb-3">
        <Trophy className="w-4 h-4" /> {t('progress.personalBests')}
      </h4>
      {isLoading ? (
        <Skeleton className="h-32" />
      ) : pbs.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">{t('progress.noData')}</p>
      ) : (
        <div className="space-y-2">
          {pbs.map(pb => (
            <div key={pb.name} className="flex items-center justify-between p-2 rounded bg-secondary/50">
              <span className="text-sm font-medium truncate">{getExerciseDisplay(pb, language)}</span>
              <span className="text-sm font-bold text-primary">{formatWeight(pb.weight, weightUnit)}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Muscle Groups Widget
function MuscleGroupsWidget({ logs, isLoading }) {
  const { t } = useLanguage();
  const muscleData = useMemo(() => {
    if (!logs?.length) return [];
    
    const groupMap = {};
    logs.forEach(log => {
      log.exercises?.forEach(ex => {
        const muscles = ex.muscle_groups || (ex.muscle_group ? [ex.muscle_group] : []);
        muscles.forEach(m => {
          groupMap[m] = (groupMap[m] || 0) + 1;
        });
      });
    });

    return Object.entries(groupMap)
      .map(([name, value]) => ({ name, value }))
      .slice(0, 6);
  }, [logs]);

  // Recharts <Cell fill="..."/> doesn't resolve CSS custom properties
  // at SVG paint time, so theme-tracking via `hsl(var(--primary))`
  // worked but the remaining slots had hardcoded hex (#f97316 etc)
  // that ignored the user's loot theme. Use chart-* CSS variables
  // (defined in src/index.css with both light + dark variants) so
  // dark mode also picks up the right palette.
  const COLORS = [
    'hsl(var(--primary))',
    'hsl(var(--chart-1))',
    'hsl(var(--chart-2))',
    'hsl(var(--chart-3))',
    'hsl(var(--chart-4))',
    'hsl(var(--chart-5))',
  ];
  // Stable color assignment by name hash so a muscle group keeps the
  // same wedge color across re-orderings (previously list order
  // determined color — adding a new group reshuffled the palette).
  const hashName = (s) => {
    let h = 0;
    for (let i = 0; i < (s || '').length; i++) {
      h = ((h << 5) - h) + s.charCodeAt(i);
      h |= 0;
    }
    return h;
  };

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
              {muscleData.map((entry) => (
                <Cell key={`cell-${entry.name}`} fill={COLORS[Math.abs(hashName(entry.name)) % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)' }} />
          </PieChart>
        </ResponsiveContainer>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        {muscleData.map(m => (
          <span key={m.name} className="text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground">
            {t(`muscleGroups.${muscleKey(m.name)}`)} ({m.value})
          </span>
        ))}
      </div>
    </Card>
  );
}

// Stats Slideshow Widget
function StatsSlideShowWidget({ logs, goals, isLoading }) {
  return (
    <div className="col-span-1 md:col-span-2">
      <StatsSlideshow logs={logs} goals={goals} isLoading={isLoading} />
    </div>
  );
}

// Last Workout Widget — summary of the most recent session.
function RecentWorkoutWidget({ logs, isLoading }) {
  const { tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const last = useMemo(() => {
    if (!logs?.length) return null;
    let best = null, bestT = -Infinity;
    for (const l of logs) {
      const d = parseLocalDate(l.date);
      const t = d ? d.getTime() : 0;
      if (t > bestT) { bestT = t; best = l; }
    }
    if (!best) return null;
    const exercises = Array.isArray(best.exercises) ? best.exercises : [];
    let sets = 0, volume = 0;
    for (const ex of exercises) {
      for (const s of (ex.sets || [])) {
        sets += 1;
        volume += (Number(s.weight) || 0) * (Number(s.reps) || 0);
      }
    }
    return {
      when: parseLocalDate(best.date),
      exercises: exercises.length,
      sets,
      volume,
      name: best.name || best.regimen_name || null,
    };
  }, [logs]);

  return (
    <Card className="p-4 col-span-1 md:col-span-2">
      <h4 className="font-semibold text-sm flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4" /> {tFallback('widgetDefs.recentWorkout.name', 'Last Workout')}
      </h4>
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : !last ? (
        <p className="text-xs text-muted-foreground py-6 text-center">{tFallback('progress.noData', 'No data yet')}</p>
      ) : (
        <div>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-heading font-bold text-base truncate">{last.name || tFallback('widgets.aWorkout', 'Workout')}</span>
            <span className="text-xs text-muted-foreground shrink-0">
              {last.when ? formatDistanceToNowStrict(last.when, { addSuffix: true }) : ''}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3">
            <MiniStat label={tFallback('widgets.exercises', 'Exercises')} value={last.exercises} />
            <MiniStat label={tFallback('widgets.sets', 'Sets')} value={last.sets} />
            <MiniStat label={tFallback('widgets.volume', 'Volume')} value={formatWeight(last.volume, weightUnit)} />
          </div>
        </div>
      )}
    </Card>
  );
}

// Workout Streak Widget — consecutive calendar days with a logged workout
// (distinct from the login streak in the hero). Streak stays "alive" if
// today isn't logged yet but yesterday was.
function WorkoutStreakWidget({ logs, isLoading }) {
  const { tFallback } = useLanguage();
  const streak = useMemo(() => {
    if (!logs?.length) return 0;
    const days = new Set();
    for (const l of logs) {
      const d = parseLocalDate(l.date);
      if (d) days.add(localDayKey(d));
    }
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    if (!days.has(localDayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
    let s = 0;
    while (days.has(localDayKey(cursor))) { s += 1; cursor.setDate(cursor.getDate() - 1); }
    return s;
  }, [logs]);

  return (
    <Card className="p-4 flex flex-col min-h-[150px]">
      <h4 className="font-semibold text-sm flex items-center gap-2 mb-2">
        <Flame className="w-4 h-4 text-orange-500" /> {tFallback('widgetDefs.workoutStreak.name', 'Workout Streak')}
      </h4>
      {isLoading ? (
        <Skeleton className="h-16 flex-1" />
      ) : (
        <div className="flex flex-col items-center justify-center gap-1 flex-1">
          <StreakFlame days={streak} size={38} />
          <span className="font-heading font-black text-3xl tabular-nums leading-none">{streak}</span>
          <span className="text-xs text-muted-foreground">
            {tFallback('widgets.daysTrained', 'consecutive days trained')}
          </span>
        </div>
      )}
    </Card>
  );
}

// Top Exercises Widget — most frequently performed lifts, by session count.
function TopExercisesWidget({ logs, isLoading }) {
  const { tFallback, language } = useLanguage();
  const top = useMemo(() => {
    if (!logs?.length) return [];
    const map = {};
    for (const l of logs) {
      for (const ex of (l.exercises || [])) {
        const n = (ex.name || '').trim();
        if (!n) continue;
        if (!map[n]) map[n] = { name: n, count: 0 };
        map[n].count += 1;
      }
    }
    return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [logs]);
  const max = top[0]?.count || 1;

  return (
    <Card className="p-4">
      <h4 className="font-semibold text-sm flex items-center gap-2 mb-3">
        <ListOrdered className="w-4 h-4" /> {tFallback('widgetDefs.topExercises.name', 'Top Exercises')}
      </h4>
      {isLoading ? (
        <Skeleton className="h-32" />
      ) : top.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">{tFallback('progress.noData', 'No data yet')}</p>
      ) : (
        <div className="space-y-2.5">
          {top.map((e) => (
            <div key={e.name}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium truncate">{getExerciseDisplay(e, language)}</span>
                <span className="text-xs font-bold tabular-nums text-muted-foreground shrink-0 ms-2">{e.count}×</span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${(e.count / max) * 100}%` }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Goals Progress Widget — active goals with live progress. (A dedicated
// widget rather than reusing GoalsProgressStrip, which self-hides in most
// states; a widget the user explicitly added should always render.)
function GoalsProgressWidget({ goals, logs, isLoading }) {
  const { tFallback } = useLanguage();
  const rows = useMemo(() => {
    const active = Array.isArray(goals) ? goals.filter((g) => g.status !== 'completed') : [];
    return active.slice(0, 4).map((g) => {
      let progress = 0;
      try { progress = Math.round(computeStrengthGoalProgress(g, logs).progress || 0); } catch { progress = 0; }
      return { goal: g, progress: Math.max(0, Math.min(100, progress)) };
    });
  }, [goals, logs]);

  return (
    <Card className="p-4 col-span-1 md:col-span-2">
      <h4 className="font-semibold text-sm flex items-center gap-2 mb-3">
        <Target className="w-4 h-4" /> {tFallback('widgetDefs.goalsProgress.name', 'Goals Progress')}
      </h4>
      {isLoading ? (
        <Skeleton className="h-24" />
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground py-6 text-center">{tFallback('widgets.noGoals', 'No active goals yet.')}</p>
      ) : (
        <div className="space-y-3">
          {rows.map(({ goal, progress }) => (
            <div key={goal.id}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-medium truncate">{goal.title || tFallback('widgets.aGoal', 'Goal')}</span>
                <span className="text-xs font-bold tabular-nums text-primary shrink-0 ms-2">{progress}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-secondary overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${progress}%` }}
                  transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// Today's Journal Widget — wraps the full journal component.
function JournalWidgetWrapper() {
  const { user } = useAuth();
  return (
    <div className="col-span-1 md:col-span-2">
      <JournalWidget userId={user?.id} userEmail={user?.email} />
    </div>
  );
}

// Widget Factory
export const WIDGET_COMPONENTS = {
  'exercise-trends': ExerciseTrendsWidget,
  'weekly-volume': WeeklyVolumeWidget,
  'personal-bests': PersonalBestsWidget,
  'muscle-groups': MuscleGroupsWidget,
  'stats-slideshow': StatsSlideShowWidget,
  'recent-workout': RecentWorkoutWidget,
  'workout-streak': WorkoutStreakWidget,
  'top-exercises': TopExercisesWidget,
  'goals-progress': GoalsProgressWidget,
  'journal': JournalWidgetWrapper,
};

export default function WidgetRenderer({ widgetId, logs, goals, isLoading }) {
  const Component = WIDGET_COMPONENTS[widgetId];

  const { tFallback } = useLanguage();
  if (!Component) {
    return (
      <Card className="p-4 text-center text-muted-foreground text-sm">
        {tFallback('widgets.unknown', 'Unknown widget — try removing and re-adding it.')}
      </Card>
    );
  }

  // Wrap each widget so a render-time throw in one (a corrupt logs
  // row, a Recharts edge case) doesn't take down the whole dashboard
  // grid. Each widget gets its own ErrorBoundary with the widgetId in
  // the label so observability can map it back to the failing one.
  return (
    <ErrorBoundary label={`widget:${widgetId}`}>
      <Component logs={logs} goals={goals} isLoading={isLoading} />
    </ErrorBoundary>
  );
}