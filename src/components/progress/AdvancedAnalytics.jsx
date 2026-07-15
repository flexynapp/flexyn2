import React, { useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Trophy, Zap, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight } from '@/lib/weightUnit';
import { muscleKey, translateExerciseName } from '@/lib/exerciseTranslations';

export default function AdvancedAnalytics({ open, onClose, logs, children, heroStats = [] }) {
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const stats = useMemo(() => {
    // Hard-guard empty logs at the top of the memo. The parent's early
    // return at the JSX level still runs this useMemo on the first
    // empty paint — without this guard, `Math.round(0/0)` produced
    // `NaN min` displayed for one frame. (Audit 11 #13.)
    if (!Array.isArray(logs) || logs.length === 0) return [];

    // Calculate various interesting stats
    const allExercises = new Map();
    let totalVolume = 0;
    let totalWorkoutDuration = 0;
    const muscleGroupVolume = {};

    logs.forEach(log => {
      if (log.duration_minutes) totalWorkoutDuration += log.duration_minutes;
      
      (log.exercises || []).forEach(ex => {
        const vol = (ex.sets || []).reduce((sum, s) => {
          const exerciseVol = (s.weight || 0) * (s.reps || 0);
          totalVolume += exerciseVol;
          const group = ex.muscle_group || ex.muscle_groups?.[0] || 'Other';
          muscleGroupVolume[group] = (muscleGroupVolume[group] || 0) + exerciseVol;
          return sum + exerciseVol;
        }, 0);

        if (!allExercises.has(ex.name)) {
          allExercises.set(ex.name, { maxWeight: 0, maxReps: 0, timesPerformed: 0 });
        }
        const ex_stats = allExercises.get(ex.name);
        ex_stats.timesPerformed += 1;
        ex.sets?.forEach(s => {
          if (s.weight && s.weight > ex_stats.maxWeight) ex_stats.maxWeight = s.weight;
          if (s.reps && s.reps > ex_stats.maxReps) ex_stats.maxReps = s.reps;
        });
      });
    });

    const sortedExercises = Array.from(allExercises.entries())
      .map(([name, stats]) => ({ name, ...stats }))
      .sort((a, b) => b.maxWeight - a.maxWeight);

    const topMuscleEn = Object.entries(muscleGroupVolume).sort((a, b) => b[1] - a[1])[0]?.[0];
    const favoriteEn = sortedExercises[0]?.name;
    const mostPerformedEn = sortedExercises.slice().sort((a, b) => b.timesPerformed - a.timesPerformed)[0]?.name;

    return [
      { label: t('widgets.totalWorkouts'), value: logs.length.toString(), icon: Zap, color: 'text-orange-500' },
      // formatWeight already converts lbs → display unit internally.
      // The previous `formatWeight(fromLbs(totalVolume, weightUnit), weightUnit)`
      // converted twice — kg users saw roughly half their actual volume.
      // (Audit 11 #5.)
      { label: t('analytics.totalVolume'), value: formatWeight(totalVolume, weightUnit), icon: TrendingUp, color: 'text-primary' },
      { label: t('analytics.totalTime'), value: `${Math.round(totalWorkoutDuration)} min`, icon: Trophy, color: 'text-amber-500' },
      // "Favorite" = most-performed (count), not heaviest. Previously
      // `favoriteEn` was the heaviest, so "Favorite exercise" and
      // "Strongest lift" labelled the same row twice. (Audit 11 #14.)
      { label: t('analytics.favoriteExercise'), value: mostPerformedEn ? translateExerciseName(mostPerformedEn, language) : 'N/A', icon: Zap, color: 'text-accent' },
      // Same double-conversion bug as totalVolume — pass lbs directly.
      // Strongest lift stays sorted by maxWeight via sortedExercises[0].
      { label: t('analytics.strongestLift'), value: `${formatWeight(sortedExercises[0]?.maxWeight || 0, weightUnit)} (${favoriteEn ? translateExerciseName(favoriteEn, language) : 'N/A'})`, icon: Trophy, color: 'text-purple-500' },
      { label: t('analytics.mostReps'), value: `${Math.max(...Array.from(allExercises.values()).map(e => e.maxReps), 0)} reps`, icon: TrendingUp, color: 'text-emerald-500' },
      { label: t('analytics.uniqueExercises'), value: allExercises.size.toString(), icon: Zap, color: 'text-cyan-500' },
      { label: t('analytics.topMuscle'), value: topMuscleEn ? t(`muscleGroups.${muscleKey(topMuscleEn)}`) : 'N/A', icon: Trophy, color: 'text-rose-500' },
      { label: t('analytics.avgDuration'), value: `${Math.round(totalWorkoutDuration / logs.length)} min`, icon: Zap, color: 'text-indigo-500' },
      { label: t('analytics.mostPerformed'), value: mostPerformedEn ? translateExerciseName(mostPerformedEn, language) : 'N/A', icon: TrendingUp, color: 'text-sky-500' },
    ];
  }, [logs, t, language, weightUnit]);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl">{t('analytics.title')}</DialogTitle>
        </DialogHeader>
        
        {/* At-a-glance tiles (Streak / Workouts / Volume / Level) — moved
            here from the top of the Progress page. Shown even at the
            zero-state, since streak/level/etc. are meaningful then too. */}
        {heroStats.length > 0 && (
          <div className="grid grid-cols-4 gap-2 md:gap-3 pe-4">
            {heroStats.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.label} className="p-3 border-border/60 shadow-sm text-center h-full">
                  <div className={`w-8 h-8 rounded-xl ${stat.iconBg} flex items-center justify-center mx-auto mb-2`}>
                    <Icon className={`w-4 h-4 ${stat.accent}`} />
                  </div>
                  <p className={`font-heading font-black text-lg leading-none ${stat.accent}`}>{stat.value}</p>
                  <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider leading-tight">{stat.label}</p>
                </Card>
              );
            })}
          </div>
        )}

        {logs.length === 0 ? (
          <div className="p-8 text-center">
            <p className="text-muted-foreground">{t('progress.noDataDesc')}</p>
          </div>
        ) : (
          <div className="space-y-6 pe-4">
            <div className="space-y-3">
              {stats.map((stat, idx) => {
                const Icon = stat.icon;
                return (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: idx * 0.05 }}
                  >
                    <Card className="p-4 border-none shadow-sm flex items-start gap-4 hover:shadow-md transition-shadow">
                      <div className={`w-10 h-10 rounded-lg bg-secondary flex items-center justify-center shrink-0 ${stat.color}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
                        <p className="font-heading font-bold text-lg mt-0.5 break-words">{stat.value}</p>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
            {/* Charts moved here from the removed "Analytics" tab. */}
            {children && <div className="pt-4 border-t border-border">{children}</div>}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}