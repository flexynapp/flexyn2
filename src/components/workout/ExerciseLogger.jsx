import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, History } from 'lucide-react';
import { toast } from 'sonner';
import SetRow from './SetRow';
import { getRecentSessionsForExercise, formatSetsLine } from '@/lib/data/exerciseHistory';
import { suggestNext as suggestProgression } from '@/lib/progressiveOverload';
import { motion, AnimatePresence } from 'framer-motion';
import { getMaxSetsPerExercise } from '@/lib/workoutFatigue';
import { useLanguage } from '@/lib/LanguageContext';
import { useRestTimer } from '@/lib/RestTimerContext';
import { muscleKey, translateExerciseName } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '../../lib/WeightUnitContext';
import { fromLbs, formatWeight } from '../../lib/weightUnit';
import { triggerHaptic } from '@/lib/haptic';
import { BAR_PRESETS, getActiveBarLbs, setActiveBarLbs } from '@/lib/barInventory';

// Epley 1RM formula
const epley1RM = (weight, reps) => {
  if (!weight || !reps || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
};

// Bodyweight exercise detection — pure name regex so we don't need
// every entry in EXERCISE_LIBRARY to be re-tagged. The weight input
// for these is "added load on top of bodyweight" (e.g. +25 on a
// weighted pull-up); 0 / blank means "just bodyweight."
const BW_REGEX = /\b(pull[- ]?up|chin[- ]?up|push[- ]?up|dip|muscle[- ]?up|pistol squat|handstand|burpee|air squat|bodyweight)\b/i;
function isBodyweightExercise(name) {
  return BW_REGEX.test(String(name || ''));
}

export default function ExerciseLogger({ exercise, onChange, onViewForm, userProfile = {}, prIndex = {}, workoutLogs = [] }) {
  // Last 3 sessions' sets for this exercise. Pulled from the user's
  // cached workout-log array — no extra query. Self-collapses to []
  // for first-ever attempts so the hint hides gracefully.
  const recentSessions = useMemo(
    () => getRecentSessionsForExercise(workoutLogs, exercise.name || exercise.displayName, 3),
    [workoutLogs, exercise.name, exercise.displayName]
  );
  // Auto-progressive-overload hint — looks at the user's last
  // session for THIS exercise and suggests a target. Quiet by
  // design: renders nothing without enough history.
  const progressionHint = useMemo(
    () => suggestProgression(exercise.name || exercise.displayName, workoutLogs),
    [workoutLogs, exercise.name, exercise.displayName]
  );
  const { t, language } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { start: startRestTimer, addTime: addRestTime, active: restActive } = useRestTimer();
  const sets = exercise.sets || [];
  const muscles = exercise.muscle_groups?.length ? exercise.muscle_groups : (exercise.muscle_group ? [exercise.muscle_group] : []);
  // Detect bodyweight exercises by name so the SetRow can label the
  // weight input "+lb" instead of just "lb" (added weight on top of
  // bodyweight). Pure name regex — no library tag needed.
  const isBodyweight = isBodyweightExercise(exercise.name || exercise.displayName || '');
  // Barbell movements get a quick bar-weight toggle so the plate math uses
  // the right tare (Olympic 45 / women's 35 / EZ 25 / trap 60 …). Sets the
  // app-wide active bar, which SetRow's plate diagram + the calculator read.
  const isBarbell = !isBodyweight
    && /barbell|squat|deadlift|bench|press|row|clean|snatch|overhead|ohp/i.test(exercise.name || exercise.displayName || '');
  const [barLbs, setBarLbs] = useState(() => getActiveBarLbs());
  const totalVolume = sets.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
  const maxSetsPerExercise = getMaxSetsPerExercise(userProfile);
  const atSetLimit = sets.length >= maxSetsPerExercise;

  // Session-best 1RM tracking — fires haptic [50,30,100] when a new intra-session PR is hit
  const sessionBest1RMRef = useRef(0);

  // Warm-up detector: seed a freshly-added exercise's first set from last
  // session. If the lifter was working heavy (top working set > 135 lb),
  // seed a flagged WARM-UP set at ~50% (so it never reads as a real
  // working set / fake PR); for lighter isolation work, copy the weight
  // straight across. Fires once, only on a pristine single empty set.
  const prefilledRef = useRef(false);
  useEffect(() => {
    if (prefilledRef.current) return;
    if (sets.length !== 1) return;
    const s0 = sets[0] || {};
    if (s0.weight != null || s0.reps != null || s0.is_warmup) return;
    const lastSession = recentSessions[0] || [];
    const working = lastSession.filter(s => !s.is_warmup && ((Number(s.weight) || 0) > 0 || (Number(s.reps) || 0) > 0));
    if (working.length === 0) return;
    const topW = Math.max(...working.map(s => Number(s.weight) || 0));
    if (topW <= 0) return; // bodyweight / unloaded — leave it empty
    prefilledRef.current = true;
    const firstReps = Number(working[0]?.reps) || 8;
    const HEAVY_LBS = 135;
    if (topW > HEAVY_LBS) {
      const warm = Math.max(45, Math.round((topW * 0.5) / 5) * 5);
      onChange({ ...exercise, sets: [{ weight: warm, reps: Math.min(10, firstReps || 10), is_warmup: true }] });
    } else {
      onChange({ ...exercise, sets: [{ weight: topW, reps: firstReps, is_warmup: false }] });
    }
  }, [recentSessions, sets, exercise, onChange]);

  const checkPR = (updatedSets) => {
    let best = 0;
    for (const s of updatedSets) {
      const rm = epley1RM(s.weight || 0, s.reps || 0);
      if (rm > best) best = rm;
    }
    if (best > 0 && best > sessionBest1RMRef.current) {
      sessionBest1RMRef.current = best;
      // Audit B-5 — route through triggerHaptic so the user's
      // per-device haptics-disabled setting is respected.
      triggerHaptic?.('success');
    }
  };

  const addSet = () => {
    if (atSetLimit) {
      toast.info(t('workout.maxSetsToast').replace('{count}', maxSetsPerExercise));
      return;
    }
    // Inherit from the last NON-warmup set so a warmup→working transition
    // doesn't carry warmup weight into the working set silently (audit
    // C-13). Falls back to the last set when no working set exists yet.
    const lastWorking = [...sets].reverse().find(s => !s.is_warmup);
    const seed = lastWorking || sets[sets.length - 1] || { weight: null, reps: null };
    const previousSetLogged = !!(seed.weight || seed.reps);
    // is_warmup explicitly false so the new set never inherits the flag.
    onChange({ ...exercise, sets: [...sets, { weight: seed.weight, reps: seed.reps, is_warmup: false }] });
    if (previousSetLogged) {
      startRestTimer();
    }
  };

  const updateSet = (index, updated) => {
    const newSets = [...sets];
    const prev = newSets[index] || {};
    newSets[index] = updated;
    checkPR(newSets);
    onChange({ ...exercise, sets: newSets });
    // Auto-start the rest timer the moment a set transitions to
    // "fully logged". For barbell/DB lifts that means both weight + reps;
    // for bodyweight exercises (pushups, pullups), weight = 0 is the
    // valid normal state — gating on (weight > 0) suppressed the
    // timer entirely for bodyweight users (audit C-14). Use reps as
    // the canonical completion signal, augmented by weight for loaded
    // exercises.
    const repsBecameValid = !(prev.reps > 0) && (updated.reps > 0);
    const weightBecameValid = !(prev.weight > 0) && (updated.weight > 0);
    const justCompleted = isBodyweight
      ? repsBecameValid
      : (repsBecameValid || weightBecameValid) && !!(updated.weight && updated.reps);
    if (justCompleted && !updated.is_warmup) {
      startRestTimer();
    }

    // Rest-timer back-off: when effort is tagged on a set mid-rest, nudge
    // the running countdown. A brutal set (RPE>=9 / RIR<=1) earns +30s; an
    // easy one (RIR>=4) trims 30s. Fires once on the transition into a
    // tagged value so re-taps don't stack.
    const hadEffort = prev.rir != null || prev.rpe != null;
    const hasEffort = updated.rir != null || updated.rpe != null;
    if (restActive && !hadEffort && hasEffort) {
      const hard = (updated.rpe != null && updated.rpe >= 9) || (updated.rir != null && updated.rir <= 1);
      const easy = (updated.rir != null && updated.rir >= 4);
      if (hard) { addRestTime(30); triggerHaptic('warning'); }
      else if (easy) { addRestTime(-30); }
    }
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
          {isBarbell && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Bar</span>
              <select
                value={barLbs}
                onChange={(e) => { const v = Number(e.target.value); setActiveBarLbs(v); setBarLbs(v); }}
                aria-label="Barbell weight"
                className="text-xs bg-secondary/60 border border-border rounded-md px-1.5 py-0.5 focus:outline-none focus:border-primary/50"
              >
                {BAR_PRESETS.map(b => (
                  <option key={b.id} value={b.lbs}>{b.label}</option>
                ))}
              </select>
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
          {/* Progressive-overload hint — color tints by kind so the
              user can scan-read intent (bump = primary, hold = amber,
              regress = muted). */}
          {progressionHint && (
            <p className={`mt-1 text-[10px] font-medium ${
              progressionHint.kind === 'bump'    ? 'text-primary' :
              progressionHint.kind === 'hold'    ? 'text-amber-500' :
                                                   'text-muted-foreground'
            }`}>
              💡 {progressionHint.message}
            </p>
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
              <SetRow set={set} index={i} onChange={(s) => updateSet(i, s)} onRemove={() => removeSet(i)} exerciseName={exercise.name} userProfile={userProfile} prIndex={prIndex} isBodyweight={isBodyweight} prevFeelNote={i > 0 ? (sets[i - 1]?.feel_note || '') : ''} />
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