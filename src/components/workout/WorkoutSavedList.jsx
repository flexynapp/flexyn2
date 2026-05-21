import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dumbbell, ChevronRight } from 'lucide-react';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { getDateLocale } from '@/lib/dateLocales';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export default function WorkoutSavedList({ onSelectLog }) {
  const { t, tFallback, language } = useLanguage();
  const { user } = useAuth();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);

  const { data: logs = [], isLoading } = useQuery({
    queryKey: ['workoutLogs', user?.email],
    queryFn: () => db.entities.WorkoutLog.filter(
      { created_by: user.email }, '-date', 50
    ),
    enabled: !!user?.email,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <Card className="p-8 border-dashed flex flex-col items-center gap-3 text-center">
        <Dumbbell className="w-8 h-8 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          {tFallback('workout.noSavedWorkouts', 'No saved workouts yet')}
        </p>
      </Card>
    );
  }

  return (
    <motion.div
      className="space-y-3"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {logs.map(log => {
        const exercises = log.exercises || [];
        const totalSets = exercises.reduce((sum, ex) => sum + (ex.sets?.length || 0), 0);
        const totalVolumeLbs = exercises.reduce((sum, ex) =>
          sum + (ex.sets || []).reduce((s, set) =>
            s + (Number(set.weight) || 0) * (Number(set.reps) || 0), 0), 0);
        const totalVolumeDisplay = totalVolumeLbs > 0
          ? `${Math.round(fromLbs(totalVolumeLbs, weightUnit)).toLocaleString()} ${weightUnit}`
          : '';

        const exLabel = exercises.length === 1
          ? `1 ${tFallback('workout.exerciseSingular', 'exercise')}`
          : exercises.length > 1
            ? `${exercises.length} ${t('workout.exercises').toLowerCase()}`
            : '';
        const setLabel = totalSets === 1
          ? `1 ${tFallback('workout.setSingular', 'set')}`
          : totalSets > 1
            ? `${totalSets} ${t('common.sets').toLowerCase()}`
            : '';

        const subtitle = [
          log.date ? format(parseISO(log.date), 'MMM d', { locale: dateLocale }) : '',
          exLabel,
          setLabel,
          totalVolumeDisplay,
        ].filter(Boolean).join(' • ');

        const title = log.regimen_name || t('workout.freestyle');

        return (
          <motion.div key={log.id} variants={itemVariants}>
            <Card
              className="p-4 cursor-pointer hover:bg-secondary/40 transition-colors"
              onClick={() => onSelectLog(log)}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Dumbbell className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{title}</p>
                  <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </div>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}