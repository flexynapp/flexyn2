import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { motion } from 'framer-motion';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, Zap, Trophy, Target } from 'lucide-react';
import { subDays } from 'date-fns';
import StatsSlideshow from './StatsSlideshow';
import { useLanguage } from '@/lib/LanguageContext';
import { muscleKey, getExerciseDisplay } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { parseLocalDate } from '@/lib/dateUtils';
import { fromLbs, formatWeight } from '@/lib/weightUnit';

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

// Widget Factory
export const WIDGET_COMPONENTS = {
  'exercise-trends': ExerciseTrendsWidget,
  'weekly-volume': WeeklyVolumeWidget,
  'personal-bests': PersonalBestsWidget,
  'muscle-groups': MuscleGroupsWidget,
  'stats-slideshow': StatsSlideShowWidget,
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

  return <Component logs={logs} goals={goals} isLoading={isLoading} />;
}