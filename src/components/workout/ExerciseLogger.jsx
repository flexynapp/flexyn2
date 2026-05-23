import React, { useRef, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, History } from 'lucide-react';
import { toast } from 'sonner';
import SetRow from './SetRow';
import { getRecentSessionsForExercise, formatSetsLine } from '@/lib/data/exerciseHistory';
import { motion, AnimatePresence } from 'framer-motion';
import { getMaxSetsPerExercise } from '@/lib/workoutFatigue';
import { useLanguage } from '@/lib/LanguageContext';
import { useRestTimer } from '@/lib/RestTimerContext';
import { muscleKey, translateExerciseName } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '../../lib/WeightUnitContext';
import { fromLbs, formatWeight } from '../../lib/weightUnit';

// Epley 1RM formula
const epley1RM = (weight, reps) => {
  if (!weight || !reps || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
};

export default function ExerciseLogger({ exercise, onChange, onViewForm, userProfile = {}, prIndex = {}, workoutLogs = [] }) {
  // Last 3 sessions' sets for this exercise. Pulled from the user's
  // cached workout-log array — no extra query. Self-collapses to []
  // for first-ever attempts so the hint hides gracefully.
  const recentSessions = useMemo(
    () => getRecentSessionsForExercise(workoutLogs, exercise.name || exercise.displayName, 3),
    [workoutLogs, exercise.name, exercise.displayName]
  );
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { start: startRestTimer } = useRestTimer();
  const sets = exercise.sets || [];
  const muscles = exercise.muscle_groups?.length ? exercise.muscle_groups : (exercise.muscle_group ? [exercise.muscle_group] : []);
  const totalVolume = sets.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
  const maxSetsPerExercise = getMaxSetsPerExercise(userProfile);
  const atSetLimit = sets.length >= maxSetsPerExercise;

  // Session-best 1RM tracking — fires haptic [50,30,100] when a new intra-session PR is hit
  const sessionBest1RMRef = useRef(0);

  const checkPR = (updatedSets) => {
    let best = 0;
    for (const s of updatedSets) {
      const rm = epley1RM(s.weight || 0, s.reps || 0);
      if (rm > best) best = rm;
    }
    if (best > 0 && best > sessionBest1RMRef.current) {
      sessionBest1RMRef.current = best;
      try { if (navigator.vibrate) navigator.vibrate([50, 30, 100]); } catch {}
    }
  };

  const addSet = () => {
    if (atSetLimit) {
      toast.info(t('workout.maxSetsToast').replace('{count}', maxSetsPerExercise));
      return;
    }
    const lastSet = sets[sets.length - 1] || { weight: null, reps: null };
    // Only start the rest timer if the previous set has actually been logged
    // (has weight or reps) — otherwise the user is just preparing the first
    // set and doesn't need to rest yet.
    const previousSetLogged = !!(lastSet.weight || lastSet.reps);
    onChange({ ...exercise, sets: [...sets, { weight: lastSet.weight, reps: lastSet.reps }] });
    if (previousSetLogged) {
      startRestTimer();
    }
  };

  const updateSet = (index, updated) => {
    const newSets = [...sets];
    newSets[index] = updated;
    checkPR(newSets);
    onChange({ ...exercise, sets: newSets });
  };

  const removeSet = (index) => {
    onChange({ ...exercise, sets: sets.filter((_, i) => i !== index) });
  };

  return (
    <Card className="p-4 border-none shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h4 className="font-medium text-sm">{exercise.displayName || translateExerciseName(exercise.name, language)}</h4>
          {muscles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {muscles.map(m => (
                <Badge key={m} variant="secondary" className="text-xs">{t(`muscleGroups.${muscleKey(m)}`)}</Badge>
              ))}
            </div>
          )}
          {/* Last-session sidebar — "Last: 185×8, 185×8, 185×7".
              Renders only when this exercise has been logged before;
              otherwise the line hides (a "Last: (nothing)" hint would
              be misleading). Helps the user pick a starting weight
              without flipping between screens. */}
          {recentSessions.length > 0 && (
            <div className="mt-1.5 space-y-0.5">
              {recentSessions.slice(0, 3).map((sessionSets, idx) => {
                const line = formatSetsLine(sessionSets);
                if (!line) return null;
                return (
                  <div key={idx} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    {idx === 0 && <History className="w-3 h-3 shrink-0" aria-hidden="true" />}
                    <span className={idx === 0 ? 'font-semibold' : 'pl-4'}>{line}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {totalVolume > 0 && (
        <div className="flex justify-end mb-2">
          <span className="text-xs text-muted-foreground font-medium">
            {formatWeight(fromLbs(totalVolume, weightUnit), weightUnit)} vol
          </span>
        </div>
      )}

      <div className="space-y-2 mb-3">
        {sets.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <span className="w-6 text-center">{t('workout.set')}</span>
            <span className="flex-1 text-center">{t('workout.weightWithUnit').replace('lbs', weightUnit)}</span>
            <span className="w-4"></span>
            <span className="flex-1 text-center">{t('workout.repsLabel')}</span>
            <span className="w-8"></span>
          </div>
        )}
        <AnimatePresence initial={false}>
          {sets.map((set, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, height: 0, y: -6 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={{ opacity: 0, height: 0, y: -6 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
            >
              <SetRow set={set} index={i} onChange={(s) => updateSet(i, s)} onRemove={() => removeSet(i)} exerciseName={exercise.name} userProfile={userProfile} prIndex={prIndex} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <motion.div whileTap={{ scale: 0.96 }} whileHover={{ scale: 1.02 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full"
          onClick={addSet}
          disabled={atSetLimit}
          title={atSetLimit ? t('workout.maxSetsTitle').replace('{count}', maxSetsPerExercise) : undefined}
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> {atSetLimit ? t('workout.maxSetsReachedLabel').replace('{count}', maxSetsPerExercise) : t('workout.addSet')}
        </Button>
      </motion.div>

      {/* Per-exercise tempo + notes — both optional, both hidden behind
          a single collapsed chevron so the default ExerciseLogger
          stays compact. Each persists onto the exercise object via
          the existing onChange path and lands in the JSONB exercises
          column on save. */}
      <ExerciseExtras exercise={exercise} onChange={onChange} />
    </Card>
  );
}

// ── Tempo + notes drawer ──────────────────────────────────────────────────────
function ExerciseExtras({ exercise, onChange }) {
  const hasExtras = !!(exercise?.tempo || exercise?.notes);
  const [open, setOpen] = React.useState(hasExtras);
  return (
    <div className="mt-3 pt-2 border-t border-border/40">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 transition-colors ${
          hasExtras ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
        }`}
      >
        {open ? '▾' : '▸'} Tempo · notes {hasExtras && <span className="opacity-70">·</span>}
        {exercise?.tempo && <span className="font-mono text-[10px] opacity-80">{exercise.tempo}</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Tempo</label>
            <input
              type="text"
              value={exercise?.tempo || ''}
              onChange={(e) => onChange({ ...exercise, tempo: e.target.value.slice(0, 12) || null })}
              placeholder="3-1-2  (ecc-pause-conc)"
              maxLength={12}
              className="w-full mt-0.5 px-2 py-1 text-xs font-mono bg-secondary/40 border border-border rounded-md outline-none focus:border-primary/50"
            />
          </div>
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Notes</label>
            <textarea
              value={exercise?.notes || ''}
              onChange={(e) => onChange({ ...exercise, notes: e.target.value.slice(0, 240) || null })}
              placeholder="Felt weak today, lower the working weight next time…"
              rows={2}
              maxLength={240}
              className="w-full mt-0.5 px-2 py-1.5 text-xs bg-secondary/40 border border-border rounded-md outline-none focus:border-primary/50 resize-none"
            />
          </div>
        </div>
      )}
    </div>
  );
}