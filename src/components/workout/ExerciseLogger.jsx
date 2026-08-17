import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Plus, History, CheckCircle2, Check, Pencil } from 'lucide-react';
import { toast } from '@/lib/toast';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import SetRow from './SetRow';
import { getRecentSessionsDetailed, getLastImplementForExercise, formatSetsLine } from '@/lib/data/exerciseHistory';
import { suggestNext as suggestProgression } from '@/lib/progressiveOverload';
import { motion, AnimatePresence } from 'framer-motion';
import { getMaxSetsPerExercise } from '@/lib/workoutFatigue';
import { useLanguage } from '@/lib/LanguageContext';
import { useRestTimer } from '@/lib/RestTimerContext';
import { muscleKey, translateExerciseName } from '@/lib/exerciseTranslations';
import { useWeightUnit } from '../../lib/WeightUnitContext';
import { formatWeight } from '../../lib/weightUnit';
import { triggerHaptic } from '@/lib/haptic';
import { BAR_PRESETS, getActiveBarLbs, setActiveBarLbs } from '@/lib/barInventory';
import ImplementPicker from './ImplementPicker';
import ExerciseFormPanel from '@/components/exercise/ExerciseFormPanel';
import EquipmentThumb from './EquipmentThumb';
import { IMPLEMENT_TYPE_META } from '@/lib/equipmentCatalog';

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
export function isBodyweightExercise(name) {
  return BW_REGEX.test(String(name || ''));
}

export default function ExerciseLogger({ exercise, onChange, onViewForm, userProfile = {}, prIndex = {}, workoutLogs = [] }) {
  // Last 3 sessions' sets for this exercise. Pulled from the user's
  // cached workout-log array — no extra query. Self-collapses to []
  // for first-ever attempts so the hint hides gracefully.
  const recentSessions = useMemo(
    () => getRecentSessionsDetailed(workoutLogs, exercise.name || exercise.displayName, 3),
    [workoutLogs, exercise.name, exercise.displayName]
  );
  // Auto-progressive-overload hint — looks at the user's last
  // session for THIS exercise and suggests a target. Quiet by
  // design: renders nothing without enough history.
  // Passing the implement lets the suggester snap to weights this gear
  // can actually be set to — see snapToSelectable.
  const progressionHint = useMemo(
    () => suggestProgression(exercise.name || exercise.displayName, workoutLogs,
                             { implement: exercise.equipment || null }),
    [workoutLogs, exercise.name, exercise.displayName, exercise.equipment]
  );
  const { t, language, tFallback } = useLanguage();
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
  // The name regex is broad on purpose (it has to catch "Bench Press",
  // "Pendlay Row"), but it also matches "Leg Press" and "Chest Press
  // Machine" — which is why a leg press used to offer a bar-weight
  // picker and a barbell plate diagram. Now that the user can state
  // which implement they're on, an explicit non-barbell choice
  // overrides the guess. No equipment chosen = unchanged behavior.
  const implementKind = exercise.equipment?.implementType
    ? IMPLEMENT_TYPE_META[exercise.equipment.implementType]?.kind
    : null;
  const isBarbell = !isBodyweight
    && (implementKind == null || implementKind === 'barbell')
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
  // ...and the machine from the last time this exercise was logged, so
  // the picker is usually already right and the user only touches it
  // when they've actually moved.
  //
  // BOTH SEEDS SHARE ONE EFFECT AND ONE onChange ON PURPOSE. As two
  // separate effects they fired in the same commit, each spreading the
  // same stale `exercise`, so whichever ran second silently discarded
  // the other's write — the machine landed and the warm-up set was
  // thrown away. onChange takes an object, not an updater function, so
  // there's no functional-setState escape hatch; merging the writes is
  // the fix. Anything else seeded here must join this effect, not add
  // a third one.
  //
  // Two independent flags rather than one: the warm-up seed needs a
  // pristine single set, the machine doesn't, so they can legitimately
  // become eligible at different times.
  const seededRef = useRef({ sets: false, implement: false });
  useEffect(() => {
    const patch = {};

    if (!seededRef.current.implement) {
      if (exercise.equipment) {
        // An explicit choice (including a deliberate clear) is never
        // overwritten — mark it handled and never look again.
        seededRef.current.implement = true;
      } else {
        const last = getLastImplementForExercise(workoutLogs, exercise.name || exercise.displayName);
        if (last) {
          seededRef.current.implement = true;
          patch.equipment = last;
        }
      }
    }

    if (!seededRef.current.sets && sets.length === 1) {
      const s0 = sets[0] || {};
      const pristine = s0.weight == null && s0.reps == null && !s0.is_warmup;
      if (pristine) {
        const lastSession = recentSessions[0]?.sets || [];
        const working = lastSession.filter(s => !s.is_warmup && ((Number(s.weight) || 0) > 0 || (Number(s.reps) || 0) > 0));
        if (working.length > 0) {
          const topW = Math.max(...working.map(s => Number(s.weight) || 0));
          if (topW > 0) { // bodyweight / unloaded — leave it empty
            seededRef.current.sets = true;
            const firstReps = Number(working[0]?.reps) || 8;
            const HEAVY_LBS = 135;
            patch.sets = topW > HEAVY_LBS
              ? [{ weight: Math.max(45, Math.round((topW * 0.5) / 5) * 5), reps: Math.min(10, firstReps || 10), is_warmup: true }]
              : [{ weight: topW, reps: firstReps, is_warmup: false }];
          }
        }
      }
    }

    if (Object.keys(patch).length > 0) onChange({ ...exercise, ...patch });
  }, [recentSessions, sets, exercise, onChange, workoutLogs]);

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

  // Mint a stable id for each new set so AnimatePresence can track
  // which set was removed without reassigning identity to the wrong
  // row. Using array index as key caused focus jumps + mid-typed
  // digits landing on the wrong row when a middle set was deleted.
  // (Audit 09 #C-5.)
  const newSetId = () => `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const addSet = () => {
    if (atSetLimit) {
      toast.info(t('workout.maxSetsToast', { count: maxSetsPerExercise }));
      return;
    }
    // Inherit from the last NON-warmup set so a warmup→working transition
    // doesn't carry warmup weight into the working set silently (audit
    // C-13). Falls back to the last set when no working set exists yet.
    const lastWorking = [...sets].reverse().find(s => !s.is_warmup);
    const seed = lastWorking || sets[sets.length - 1] || { weight: null, reps: null };
    const previousSetLogged = !!(seed.weight || seed.reps);
    // is_warmup explicitly false so the new set never inherits the flag.
    onChange({ ...exercise, sets: [...sets, { _key: newSetId(), weight: seed.weight, reps: seed.reps, is_warmup: false }] });
    if (previousSetLogged) {
      startRestTimer();
    }
  };

  const updateSet = (index, updated) => {
    const newSets = [...sets];
    const prev = newSets[index] || {};
    // Preserve the row's stable _key across updates. If this row was
    // hydrated from legacy data (regimen template, repeat-from-log)
    // without an _key, mint one on first update so all subsequent
    // edits + the eventual removal track to the right row.
    newSets[index] = { ...updated, _key: prev._key || updated._key || newSetId() };
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

  // ── Exercise completion ──────────────────────────────────────────────────
  // Sets carry `completed` (the ✓ Done tap). The exercise is "complete" when
  // the lifter locks it in — which collapses the card to a one-line summary so
  // a long workout stops being a wall of open cards.
  const doneCount = sets.filter(s => s.completed).length;
  const allSetsDone = sets.length > 0 && doneCount === sets.length;
  const isComplete = !!exercise.completed;
  const [confirmOpen, setConfirmOpen] = useState(false);

  const markComplete = () => {
    triggerHaptic?.('success');
    onChange({ ...exercise, completed: true });
  };
  const reopen = () => onChange({ ...exercise, completed: false });
  const handleCompleteClick = () => {
    if (allSetsDone) markComplete();
    else setConfirmOpen(true); // gate: warn before finishing with unchecked sets
  };

  // Collapsed summary — shown once the exercise is complete.
  if (isComplete) {
    return (
      <motion.div initial={{ opacity: 0.6 }} animate={{ opacity: 1 }}>
        <Card className="p-3 border border-success/25 bg-success/[0.06] shadow-none">
          <div className="flex items-center gap-3">
            <span className="w-8 h-8 rounded-full bg-success text-white flex items-center justify-center shrink-0">
              <Check className="w-4 h-4" strokeWidth={3} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm leading-tight truncate">
                {exercise.displayName || translateExerciseName(exercise.name, language)}
              </p>
              <p className="text-micro text-muted-foreground mt-0.5 flex items-center gap-1">
                <span>
                  {sets.length} set{sets.length === 1 ? '' : 's'}
                  {totalVolume > 0 && <> · {formatWeight(totalVolume, weightUnit)} vol</>}
                </span>
                {/* Carry the chosen machine into the collapsed view —
                    a completed exercise silently dropping its label
                    reads as a bug. */}
                {exercise.equipment?.label && (
                  <>
                    <span>·</span>
                    <EquipmentThumb implement={exercise.equipment} size={14} />
                    <span className="truncate">{exercise.equipment.label}</span>
                  </>
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={reopen}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground active:text-foreground px-2 py-1.5 rounded-lg hover:bg-secondary active:bg-secondary transition-colors shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" /> {tFallback("coach.plan.edit", "Edit")}
            </button>
          </div>
        </Card>
      </motion.div>
    );
  }

  return (
    <Card className="p-4 border-none shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <div>
          {/* Title + equipment picker share a row. The picker wraps
              underneath on narrow screens rather than squeezing the
              exercise name, which is the more important of the two. */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <h4 className="font-medium text-sm">{exercise.displayName || translateExerciseName(exercise.name, language)}</h4>
            <ImplementPicker
              exerciseName={exercise.name || exercise.displayName}
              value={exercise.equipment}
              userId={userProfile?.id}
              onChange={(implement) => onChange({ ...exercise, equipment: implement || undefined })}
            />
          </div>
          {muscles.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {muscles.map(m => (
                <Badge key={m} variant="secondary" className="text-xs">{t(`muscleGroups.${muscleKey(m)}`)}</Badge>
              ))}
            </div>
          )}
          {isBarbell && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <span className="text-micro font-bold uppercase tracking-wide text-muted-foreground">{tFallback("exerciseLogger.bar", "Bar")}</span>
              <select
                value={barLbs}
                onChange={(e) => { const v = Number(e.target.value); setActiveBarLbs(v); setBarLbs(v); }}
                aria-label={tFallback("exerciseLogger.barbellWeight", "Barbell weight")}
                className="text-xs bg-secondary/60 border border-border rounded-md px-1.5 py-0.5 focus:outline-none focus:border-primary/50"
              >
                {BAR_PRESETS.map(b => (
                  <option key={b.id} value={b.lbs}>{tFallback(`bar.preset.${b.id}`, b.label)}</option>
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
              {recentSessions.slice(0, 3).map((session, idx) => {
                const line = formatSetsLine(session.sets);
                if (!line) return null;
                // Name the machine only when it CHANGED from the session
                // before — "185 on the Hammer Strength, 160 on the Cybex"
                // is the insight; repeating the same machine on every
                // line is noise that buries the numbers.
                const prev = recentSessions[idx + 1]?.equipment?.label || null;
                const here = session.equipment?.label || null;
                const showMachine = here && here !== prev;
                return (
                  <div key={idx} className="flex items-center gap-1 text-micro text-muted-foreground">
                    {idx === 0 && <History className="w-3 h-3 shrink-0" aria-hidden="true" />}
                    <span className={idx === 0 ? 'font-semibold' : 'ps-4'}>{line}</span>
                    {showMachine && (
                      <span className="truncate opacity-75">· {here}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Progressive-overload hint — color tints by kind so the
              user can scan-read intent (bump = primary, hold = amber,
              regress = muted). */}
          {progressionHint && (
            <p className={`mt-1 text-micro font-medium ${
              progressionHint.kind === 'bump'    ? 'text-primary' :
              progressionHint.kind === 'hold'    ? 'text-primary' :
                                                   'text-muted-foreground'
            }`}>
              💡 {progressionHint.message}
            </p>
          )}
        </div>
      </div>

      {/* Under the name and muscles, above the sets: this is the moment
          someone is deciding how to move, and it must not sit below the
          thing they are about to fill in.

          OUTSIDE the header, not inside its left column. That column is a
          content-sized flex child sharing a row with the PR badge, so the
          disclosure rendered at about 60% of the card's width while every
          block under it ran full-bleed — fine while it only appeared on the
          39 drawn movements, obviously wrong now that it appears on all of
          them. Renders nothing only for a custom exercise the user typed in
          themselves. */}
      <ExerciseFormPanel
        exerciseName={exercise.name || exercise.displayName}
        className="mb-3"
      />

      {totalVolume > 0 && (
        <div className="flex justify-end mb-2">
          <span className="text-xs text-muted-foreground font-medium">
            {/* formatWeight already converts lbs → display unit. The prior
                `formatWeight(fromLbs(totalVolume, weightUnit), weightUnit)`
                converted twice — kg users saw half their real per-exercise
                volume label. Same fix family as LiveVolumePill, audit 11 #11. */}
            {formatWeight(totalVolume, weightUnit)} vol
          </span>
        </div>
      )}

      <div className="space-y-2 mb-3">
        {sets.length > 0 && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
            <span className="w-6 text-center">{t('workout.set')}</span>
            <span className="flex-1 text-center">{t('workout.weightWithUnit', { unit: weightUnit })}</span>
            <span className="w-4"></span>
            <span className="flex-1 text-center">{t('workout.repsLabel')}</span>
            <span className="w-8"></span>
          </div>
        )}
        <AnimatePresence initial={false}>
          {sets.map((set, i) => (
            <motion.div
              // Use the stable _key minted at addSet time. Falls back to
              // index for legacy regimen/log-cloned data that predates
              // the minted-id pattern — but those rows mint a key on
              // first updateSet via the updateSet handler below.
              key={set?._key || `legacy_${i}`}
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
          title={atSetLimit ? t('workout.maxSetsTitle', { count: maxSetsPerExercise }) : undefined}
        >
          <Plus className="w-3.5 h-3.5 me-1" /> {atSetLimit ? t('workout.maxSetsReachedLabel', { count: maxSetsPerExercise }) : t('workout.addSet')}
        </Button>
      </motion.div>

      {/* Complete exercise — the gate. Turns solid green once every set is
          checked; tapping with sets still open warns before finishing. */}
      {sets.length > 0 && (
        <motion.button
          type="button"
          whileTap={{ scale: 0.98 }}
          onClick={handleCompleteClick}
          className={[
            'mt-2 w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors',
            allSetsDone
              ? 'bg-success text-white hover:bg-success/90 active:bg-success/90'
              : 'border border-border text-foreground hover:bg-secondary active:bg-secondary',
          ].join(' ')}
        >
          <CheckCircle2 className="w-4 h-4" />
          {tFallback('workout.completeExercise', 'Complete exercise')}
          <span className={['text-xs font-bold tabular-nums rounded-full px-1.5 py-0.5', allSetsDone ? 'bg-white/20' : 'bg-secondary'].join(' ')}>
            {doneCount}/{sets.length}
          </span>
        </motion.button>
      )}

      {/* Per-exercise tempo + notes — both optional, both hidden behind
          a single collapsed chevron so the default ExerciseLogger
          stays compact. Each persists onto the exercise object via
          the existing onChange path and lands in the JSONB exercises
          column on save. */}
      <ExerciseExtras exercise={exercise} onChange={onChange} />

      {/* Override warning — finish the exercise with sets still unchecked. */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{tFallback("exerciseLogger.finishThisExercise", "Finish this exercise?")}</AlertDialogTitle>
            <AlertDialogDescription>
              {sets.length - doneCount} of {sets.length} set{sets.length - doneCount === 1 ? " isn't" : "s aren't"} checked off yet.
              You can still complete the exercise — those sets just won't be marked done.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tFallback("exerciseLogger.keepGoing", "Keep going")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { setConfirmOpen(false); markComplete(); }}>
              {tFallback("exerciseLogger.completeAnyway", "Complete anyway")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

// ── Tempo + notes drawer ──────────────────────────────────────────────────────
function ExerciseExtras({ exercise, onChange }) {
  const { tFallback } = useLanguage();
  const hasExtras = !!(exercise?.tempo || exercise?.notes);
  const [open, setOpen] = React.useState(hasExtras);
  return (
    <div className="mt-3 pt-2 border-t border-border/40">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`text-micro font-bold uppercase tracking-wide flex items-center gap-1 transition-colors ${
          hasExtras ? 'text-primary' : 'text-muted-foreground hover:text-foreground active:text-foreground'
        }`}
      >
        {open ? '▾' : '▸'} Tempo · notes {hasExtras && <span className="opacity-70">·</span>}
        {exercise?.tempo && <span className="font-mono text-micro opacity-80">{exercise.tempo}</span>}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <div>
            <label className="text-micro font-bold uppercase tracking-wide text-muted-foreground">{tFallback("exerciseLogger.tempo", "Tempo")}</label>
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
            <label className="text-micro font-bold uppercase tracking-wide text-muted-foreground">{tFallback("cardio.field.notes", "Notes")}</label>
            <textarea
              value={exercise?.notes || ''}
              onChange={(e) => onChange({ ...exercise, notes: e.target.value.slice(0, 240) || null })}
              placeholder={tFallback("exerciseLogger.feltWeakTodayLower", "Felt weak today, lower the working weight next time…")}
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