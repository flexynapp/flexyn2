import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Dumbbell, ChevronRight, Repeat } from 'lucide-react';
import { db } from '@/api/db';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { fromLbs } from '@/lib/weightUnit';
import { getDateLocale } from '@/lib/dateLocales';
import { useNumberFormatter } from '@/lib/intl';
// Shared volume calculator used everywhere else (LiveVolumePill, save
// mutation, WorkoutShareCard). Importing here closes the drift bug
// where the Saved Workouts list showed a DIFFERENT total volume than
// the rest of the app for the same workout because it ignored the
// user's bar-weight inclusion preference. (Audit 09 #H-6.)
import { totalVolume as computeTotalVolume } from '@/lib/workoutVolume';
import { TagPillRow } from './WorkoutTags';

const containerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.05 } },
};

const itemVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0 },
};

export default function WorkoutSavedList({ onSelectLog, search = '' }) {
  const { t, tFallback, language } = useLanguage();
  const { user } = useAuth();
  const { weightUnit } = useWeightUnit();
  const dateLocale = getDateLocale(language);
  const fmt = useNumberFormatter();
  const navigate = useNavigate();

  // Navigate to the Workout page with this log pre-loaded as a template.
  // Stops the click event from also firing onSelectLog (which opens the
  // detail view), since the user has chosen a different action.
  const handleRepeat = (e, log) => {
    e.stopPropagation();
    navigate('/workout', { state: { repeatFromLog: log } });
  };

  const { data: allLogs = [], isLoading } = useQuery({
    queryKey: ['workoutLogs', user?.email],
    queryFn: () => db.entities.WorkoutLog.filter(
      { created_by: user.email }, '-date', 500
    ),
    enabled: !!user?.email,
  });

  // Search by name or date (raw ISO + human-formatted words like "July", "Mon").
  const q = (search || '').trim().toLowerCase();
  const logs = !q ? allLogs : allLogs.filter((l) => {
    const name = (l.regimen_name || 'freestyle').toLowerCase();
    let dateWords = l.date || '';
    try { if (l.date) dateWords += ' ' + format(parseISO(l.date), 'EEEE MMMM d yyyy'); } catch { /* ignore */ }
    const tags = (l.tags || []).join(' ').toLowerCase();
    return name.includes(q) || dateWords.toLowerCase().includes(q) || tags.includes(q);
  });

  // Read the user's bar-weight inclusion preference so the volume math
  // here matches LiveVolumePill / save / share card exactly.
  const { data: userProfile = {} } = useQuery({
    queryKey: ['userProfile', user?.email],
    queryFn: () => db.auth.me(),
    enabled: !!user?.email,
    staleTime: 60_000,
  });
  const includeBar = !!userProfile?.include_bar_in_volume;

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
          {allLogs.length === 0
            ? tFallback('workout.noSavedWorkouts', 'No workouts yet')
            : tFallback('workout.noMatches', 'No workouts match your search')}
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
        // Use the shared totalVolume calculator so this number matches
        // the LiveVolumePill, save mutation, and share card. Previously
        // an inline `weight * reps` ignored the user's include_bar
        // preference — kg users with bar inclusion on saw the saved
        // list under-count relative to the active session pill.
        const totalVolumeLbs = computeTotalVolume(exercises, { includeBarWeight: includeBar });
        const totalVolumeDisplay = totalVolumeLbs > 0
          ? `${fmt(Math.round(fromLbs(totalVolumeLbs, weightUnit)))} ${weightUnit}`
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
                  {Array.isArray(log.tags) && log.tags.length > 0 && (
                    <TagPillRow tags={log.tags} className="mt-1.5" />
                  )}
                </div>
                {/* Repeat — pre-fills Workout with this log's exercise
                    list (weights/reps blanked) so the user can run the
                    same session again. Hidden when there are no real
                    exercises to repeat. stopPropagation so the Card's
                    onClick (which opens detail) doesn't also fire. */}
                {exercises.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => handleRepeat(e, log)}
                    className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-micro font-bold text-primary bg-primary/10 hover:bg-primary/20 transition-colors"
                    aria-label={tFallback('workout.repeat', 'Repeat this workout')}
                  >
                    <Repeat className="w-3 h-3" />
                    {tFallback('workout.repeat', 'Repeat')}
                  </button>
                )}
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </div>
            </Card>
          </motion.div>
        );
      })}
    </motion.div>
  );
}