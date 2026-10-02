import React, { useRef, useMemo, useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Plus, History, Pencil, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from '@/lib/toast';
import SetRow from './SetRow';
import { getRecentSessionsDetailed, getLastImplementForExercise, formatSetsLine } from '@/lib/data/exerciseHistory';
import { suggestNext as suggestProgression } from '@/lib/progressiveOverload';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import BottomSheet from '@/components/ui/BottomSheet';
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
import ExerciseProgressRing from './ExerciseProgressRing';
import { IMPLEMENT_TYPE_META, implementTypeForExercise } from '@/lib/equipmentCatalog';

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

// Room to leave when scrolling the next set into view: the app header and
// the pinned session bar above, the rest timer and the tab bar below.
const NEXT_SET_CLEAR_TOP = 180;
const NEXT_SET_CLEAR_BOTTOM = 160;

// `menu` is the card's one ⋯ (ExerciseActionsMenu), handed in by the page
// so it sits in the header row beside the name instead of floating over the
// card. Optional: a superset block renders cards without one.
export default function ExerciseLogger({ exercise, onChange, onViewForm, userProfile = {}, prIndex = {}, workoutLogs = [], guideOpen, onGuideOpenChange, menu = null }) {
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
  // The Setup sheet (bar, equipment, tempo, notes, recent sessions) and the
  // equipment picker it hands off to. The picker is mounted on the card, not
  // inside the sheet, so closing the sheet to open it does not unmount it.
  const [setupOpen, setSetupOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const tap = reduceMotion ? undefined : { scale: 0.97 };
  const totalVolume = sets.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
  // Sets that beat the all-time best, for the folded summary. Same rule
  // SetRow stamps with: warm-ups and failed sets never count.
  const priorBestForPr = prIndex[(exercise.name || '').trim().toLowerCase()] || 0;
  const prSetCount = priorBestForPr > 0
    ? sets.filter(s => !s.is_warmup && !s.is_failed && epley1RM(s.weight || 0, s.reps || 0) > priorBestForPr).length
    : 0;
  // Last session's sets, lined up by position, for each row's Previous.
  const previousSets = recentSessions[0]?.sets || [];
  const maxSetsPerExercise = getMaxSetsPerExercise(userProfile);
  const atSetLimit = sets.length >= maxSetsPerExercise;

  // Session-best 1RM tracking — fires haptic [50,30,100] when a new intra-session PR is hit
  const sessionBest1RMRef = useRef(0);
  const setListRef = useRef(null);

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
    //
    // A row with no key renders under `legacy_<index>`, so the key it is
    // minted must be that same string. A fresh random id here changed the
    // React key on the row's first edit, which remounted SetRow and threw
    // away its local state: the completion animation on the very first
    // check of a regimen-loaded set never played.
    newSets[index] = { ...updated, _key: prev._key || updated._key || `legacy_${index}` };
    checkPR(newSets);
    onChange({ ...exercise, sets: newSets });
    // Checking a set brings the next open one into view, so the thumb
    // never has to go looking for it. Measured by hand rather than with
    // scrollIntoView: Chrome skips a 'nearest' scroll for a row that is
    // technically on screen even when it sits under the rest timer and the
    // tab bar, which is exactly the row this is for.
    if (!prev.completed && updated.completed) {
      const next = newSets.findIndex((s, i) => i > index && !s.completed);
      if (next !== -1) {
        setTimeout(() => {
          const el = setListRef.current?.querySelector(`[data-set-row="${next}"]`);
          if (!el) return;
          const r = el.getBoundingClientRect();
          const floor = window.innerHeight - NEXT_SET_CLEAR_BOTTOM;
          let dy = 0;
          if (r.bottom > floor) dy = r.bottom - floor;
          else if (r.top < NEXT_SET_CLEAR_TOP) dy = r.top - NEXT_SET_CLEAR_TOP;
          if (dy) {
            try { window.scrollBy({ top: dy, behavior: 'smooth' }); } catch { /* noop */ }
          }
        }, 350);
      }
    }
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

  // ── Exercise completion ──────────────────────────────────────────────────
  // Sets carry `completed` (the ✓ tap). Checking the last open set closes
  // the exercise: the ring fills, bursts, and a beat later the card folds
  // to a one-line summary so a long workout stops being a wall of open
  // cards. There is no separate "Complete exercise" button any more; it
  // asked for a second tap to confirm something the checks already said.
  //
  // Only the false→true EDGE folds it. Reopening a finished exercise to
  // fix a number must not snap shut again while every set is still ticked.
  const doneCount = sets.filter(s => s.completed).length;
  // The set about to be lifted: its row carries the plate diagram, and once
  // the exercise is under way, the outline that says "you are here".
  const nextSetIndex = sets.findIndex(s => !s.completed);
  const allSetsDone = sets.length > 0 && doneCount === sets.length;
  const isComplete = !!exercise.completed;
  const prevAllDoneRef = useRef(allSetsDone);
  const [closing, setClosing] = useState(false);
  // Refs, not deps: the parent passes a fresh onChange on every render,
  // and re-running this effect would cancel the pending fold.
  const exerciseRef = useRef(exercise);
  const onChangeRef = useRef(onChange);
  exerciseRef.current = exercise;
  onChangeRef.current = onChange;

  // Deleting a set is one swipe, so taking it back is one tap. Undo reads
  // the exercise through the refs rather than this render's closure: the
  // toast outlives the render, and restoring a stale snapshot would also
  // throw away anything typed into the other sets in the meantime.
  const removeSet = (index) => {
    const current = exerciseRef.current;
    const all = current.sets || [];
    const removed = all[index];
    if (!removed) return;
    onChangeRef.current({ ...current, sets: all.filter((_, i) => i !== index) });
    triggerHaptic?.('light');
    toast.success(tFallback('workout.setDeleted', 'Set {n} deleted', { n: index + 1 }), {
      duration: 5000,
      action: {
        label: tFallback('common.undo', 'Undo'),
        onClick: () => {
          const now = exerciseRef.current;
          const restored = [...(now.sets || [])];
          restored.splice(Math.min(index, restored.length), 0, removed);
          onChangeRef.current({ ...now, sets: restored });
        },
      },
    });
  };
  useEffect(() => {
    const was = prevAllDoneRef.current;
    prevAllDoneRef.current = allSetsDone;
    if (was || !allSetsDone || isComplete) return undefined;
    setClosing(true);
    triggerHaptic?.('success');
    const id = setTimeout(() => {
      setClosing(false);
      onChangeRef.current({ ...exerciseRef.current, completed: true });
    }, 950);
    return () => { clearTimeout(id); setClosing(false); };
  }, [allSetsDone, isComplete]);
  const reopen = () => onChange({ ...exercise, completed: false });

  // Collapsed summary — shown once the exercise is complete.
  if (isComplete) {
    return (
      <motion.div initial={{ opacity: 0.6 }} animate={{ opacity: 1 }}>
        <Card className="p-3 border border-success/25 bg-success/[0.06] shadow-none before:hidden">
          <div className="flex items-center gap-3 pe-8">
            <ExerciseProgressRing done={sets.length} total={sets.length} />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm leading-tight truncate">
                {exercise.displayName || translateExerciseName(exercise.name, language)}
              </p>
              <p className="text-micro text-muted-foreground mt-0.5 flex items-center gap-1">
                <span>
                  {sets.length} set{sets.length === 1 ? '' : 's'}
                  {totalVolume > 0 && <> · {formatWeight(totalVolume, weightUnit)}</>}
                  {prSetCount > 0 && <span className="text-success font-bold"> · PR</span>}
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
              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </Card>
      </motion.div>
    );
  }

  const exerciseTitle = exercise.displayName || translateExerciseName(exercise.name, language);
  const hasImplement = !!implementTypeForExercise(exercise.name || exercise.displayName);
  const barPreset = BAR_PRESETS.find(b => b.lbs === barLbs) || null;
  const barLabel = barPreset
    ? (barPreset.lbs > 0
      ? `${tFallback(`bar.preset.${barPreset.id}`, barPreset.label)} ${formatWeight(barPreset.lbs, weightUnit)}`
      : tFallback(`bar.preset.${barPreset.id}`, barPreset.label))
    : formatWeight(barLbs, weightUnit);
  // The pill names the one setup value that changes the numbers: the bar
  // on a barbell lift (it is what the plate math subtracts), otherwise the
  // machine, otherwise just "Setup".
  const pillLabel = isBarbell
    ? barLabel
    : (exercise.equipment?.label || tFallback('exerciseLogger.setup', 'Setup'));
  // A tempo or a note you wrote for yourself is worth seeing mid set, so it
  // stays on the card as one muted line rather than behind the pill.
  const noteLine = [exercise.tempo, exercise.notes].filter(Boolean).join(' · ');
  const openPicker = () => { setSetupOpen(false); setPickerOpen(true); };

  return (
    <Card className="p-3 rounded-2xl border border-border shadow-none before:hidden">
      {/* Header: the name, one muted line of muscles and progress, and the
          card's single ⋯. Everything you set once lives behind the Setup
          pill under it. */}
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0 pt-1">
          <h4 className="font-bold text-base leading-tight">{exerciseTitle}</h4>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {muscles.length > 0 && (
              <>{muscles.map(m => t(`muscleGroups.${muscleKey(m)}`)).join(' · ')}<span aria-hidden="true"> · </span></>
            )}
            <span className={closing ? 'text-success font-semibold transition-colors' : 'transition-colors'}>
              {tFallback('workout.setsProgress', '{done} of {total} sets', { done: doneCount, total: sets.length })}
            </span>
          </p>
        </div>
        {menu && <div className="shrink-0 -mt-1 -me-1">{menu}</div>}
      </div>

      {/* Setup pill, then a tempo or note if there is one, then this
          exercise's volume at the end of the same line. The pill is 32px
          to look at and 44px to hit. */}
      <div className="flex items-center gap-2 mt-2 min-w-0">
        <motion.button
          type="button"
          whileTap={tap}
          onClick={() => { triggerHaptic?.('light'); setSetupOpen(true); }}
          aria-haspopup="dialog"
          aria-expanded={setupOpen}
          aria-label={`${tFallback('exerciseLogger.setup', 'Setup')}: ${pillLabel}`}
          className="relative inline-flex items-center gap-1 h-8 max-w-[65%] shrink-0 rounded-full bg-secondary ps-3 pe-2 text-xs font-semibold text-foreground select-none-ui after:absolute after:inset-x-0 after:-inset-y-1.5 after:content-['']"
        >
          <span className="truncate">{pillLabel}</span>
          <ChevronRight className="w-3.5 h-3.5 shrink-0 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
        </motion.button>
        {noteLine && (
          <span className="flex-1 min-w-0 truncate text-xs text-muted-foreground">{noteLine}</span>
        )}
        {totalVolume > 0 && (
          <span className="ms-auto shrink-0 text-xs text-muted-foreground font-medium tabular-nums">
            {/* formatWeight already converts lbs → display unit. The prior
                `formatWeight(fromLbs(totalVolume, weightUnit), weightUnit)`
                converted twice — kg users saw half their real per-exercise
                volume label. Same fix family as LiveVolumePill, audit 11 #11. */}
            {formatWeight(totalVolume, weightUnit)} vol
          </span>
        )}
      </div>

      {/* Progressive-overload hint. Quiet by design: one muted line, and
          nothing at all without enough history. */}
      {progressionHint && (
        <p className={`mt-2 text-micro font-medium ${
          (progressionHint.kind === 'bump' || progressionHint.kind === 'hold') ? 'text-foreground' : 'text-muted-foreground'
        }`}>
          {progressionHint.message}
        </p>
      )}

      {/* Where the menu is handed in, "How to do it" is a row in the
          exercise ⋯ menu and the guide appears here, open, only when asked
          for. Without them (a superset block) it keeps its own disclosure.
          Renders nothing only for a custom exercise the user typed in. */}
      <ExerciseFormPanel
        exerciseName={exercise.name || exercise.displayName}
        className="mt-2"
        {...(onGuideOpenChange ? { open: !!guideOpen, onOpenChange: onGuideOpenChange } : {})}
      />

      <div ref={setListRef} className="flex flex-col gap-1 mt-2">
        {sets.length > 0 && (
          <div className="flex items-center gap-1 px-1 text-micro font-semibold uppercase tracking-wide text-muted-foreground" aria-hidden="true">
            <span className="w-11 shrink-0 text-center">{t('workout.set')}</span>
            <span className="flex-1 min-w-0 px-1 truncate">{tFallback('setRow.previous', 'Previous')}</span>
            <span className="w-16 shrink-0 text-center">{weightUnit}</span>
            <span className="w-12 shrink-0 text-center">{t('workout.repsLabel')}</span>
            {/* Holds the done column's width only. A check here repeated the
                tick button right under it, so the column carries no label. */}
            <span className="w-11 shrink-0" />
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
              initial={reduceMotion ? false : { opacity: 0, height: 0, y: -8 }}
              animate={{ opacity: 1, height: 'auto', y: 0 }}
              exit={reduceMotion ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, height: 0, x: -24 }}
              transition={{ duration: reduceMotion ? 0 : 0.22, ease: 'easeOut' }}
              style={{ overflow: 'hidden' }}
              data-set-row={i}
            >
              <SetRow set={set} index={i} isNext={i === nextSetIndex} isCurrent={i === nextSetIndex && doneCount > 0} onChange={(s) => updateSet(i, s)} onRemove={() => removeSet(i)} exerciseName={exercise.name} userProfile={userProfile} prIndex={prIndex} isBodyweight={isBodyweight} prevFeelNote={i > 0 ? (sets[i - 1]?.feel_note || '') : ''} previous={previousSets[i] || null} />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Add set: a quiet full width text row, not another outlined box. */}
      <motion.button
        type="button"
        whileTap={atSetLimit ? undefined : tap}
        onClick={addSet}
        disabled={atSetLimit}
        title={atSetLimit ? t('workout.maxSetsTitle', { count: maxSetsPerExercise }) : undefined}
        className="w-full min-h-11 mt-1 rounded-lg flex items-center justify-center gap-1 text-sm font-semibold text-muted-foreground enabled:hover:text-foreground enabled:active:text-foreground enabled:hover:bg-secondary/60 enabled:active:bg-secondary/60 disabled:opacity-60 transition-colors"
      >
        <Plus className="w-4 h-4" aria-hidden="true" /> {atSetLimit ? t('workout.maxSetsReachedLabel', { count: maxSetsPerExercise }) : t('workout.addSet')}
      </motion.button>

      {/* The equipment picker, opened from the Setup sheet's Equipment row.
          It lives here so the sheet can close as the picker opens. */}
      {hasImplement && (
        <ImplementPicker
          hideTrigger
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          exerciseName={exercise.name || exercise.displayName}
          value={exercise.equipment}
          userId={userProfile?.id}
          onChange={(implement) => onChange({ ...exercise, equipment: implement || undefined })}
        />
      )}

      <BottomSheet
        open={setupOpen}
        onClose={() => setSetupOpen(false)}
        title={tFallback('exerciseLogger.setupTitle', '{name} setup', { name: exerciseTitle })}
      >
        <ExerciseSetup
          exercise={exercise}
          onChange={onChange}
          isBarbell={isBarbell}
          barLbs={barLbs}
          onBarChange={(v) => { setActiveBarLbs(v); setBarLbs(v); }}
          hasImplement={hasImplement}
          onOpenPicker={openPicker}
          recentSessions={recentSessions}
          tap={tap}
        />
      </BottomSheet>
    </Card>
  );
}

// ── Setup sheet ───────────────────────────────────────────────────────────────
// Everything you set once and forget: the bar (which the plate math reads),
// the exact machine, tempo, notes, and the last few sessions for context.
// Replaces the equipment chip, the BAR select and the Tempo · notes drawer
// that used to sit in three places on the card face.
function ExerciseSetup({ exercise, onChange, isBarbell, barLbs, onBarChange, hasImplement, onOpenPicker, recentSessions, tap }) {
  const { tFallback } = useLanguage();
  const sectionLabel = 'text-micro font-bold uppercase tracking-wide text-muted-foreground';
  return (
    <div className="px-4 pb-6 flex flex-col gap-6">
      {(isBarbell || hasImplement) && (
        <div className="flex flex-col divide-y divide-border border-b border-border">
          {isBarbell && (
            <label className="min-h-[52px] flex items-center gap-2 py-1">
              <span className="flex-1 min-w-0 text-sm font-semibold">{tFallback('exerciseLogger.bar', 'Bar')}</span>
              <select
                value={barLbs}
                onChange={(e) => onBarChange(Number(e.target.value))}
                aria-label={tFallback('exerciseLogger.barbellWeight', 'Barbell weight')}
                className="h-11 max-w-[60%] rounded-lg bg-secondary px-2 text-sm font-medium text-foreground border border-transparent focus:outline-none focus:border-foreground/25"
              >
                {BAR_PRESETS.map(b => (
                  <option key={b.id} value={b.lbs}>{tFallback(`bar.preset.${b.id}`, b.label)}</option>
                ))}
              </select>
            </label>
          )}
          {hasImplement && (
            <motion.button
              type="button"
              whileTap={tap}
              onClick={onOpenPicker}
              aria-label={
                exercise.equipment?.label
                  ? `${tFallback('implement.choose', 'Choose equipment')}: ${exercise.equipment.label}`
                  : tFallback('implement.choose', 'Choose equipment')
              }
              className="min-h-[52px] w-full flex items-center gap-2 py-1 text-start"
            >
              <EquipmentThumb implement={exercise.equipment} size={28} />
              <span className="flex-1 min-w-0">
                <span className="block text-sm font-semibold">{tFallback('exerciseLogger.equipment', 'Equipment')}</span>
                <span className="block text-xs text-muted-foreground truncate">
                  {exercise.equipment?.label || tFallback('exerciseLogger.equipmentHint', 'Add the exact machine or bar you use')}
                </span>
              </span>
              <ChevronRight className="w-4 h-4 shrink-0 text-muted-foreground rtl:scale-x-[-1]" aria-hidden="true" />
            </motion.button>
          )}
        </div>
      )}

      <label className="flex flex-col gap-2">
        <span className={sectionLabel}>{tFallback('exerciseLogger.tempo', 'Tempo')}</span>
        <input
          type="text"
          value={exercise?.tempo || ''}
          onChange={(e) => onChange({ ...exercise, tempo: e.target.value.slice(0, 12) || null })}
          placeholder="3-1-2"
          maxLength={12}
          className="w-full h-11 px-3 text-sm tabular-nums bg-transparent border border-border rounded-lg outline-none focus:border-foreground/40"
        />
        <span className="text-xs text-muted-foreground">
          {tFallback('exerciseLogger.tempoHint', 'Seconds down, pause, then up')}
        </span>
      </label>

      <label className="flex flex-col gap-2">
        <span className={sectionLabel}>{tFallback('cardio.field.notes', 'Notes')}</span>
        <textarea
          value={exercise?.notes || ''}
          onChange={(e) => onChange({ ...exercise, notes: e.target.value.slice(0, 240) || null })}
          placeholder={tFallback('exerciseLogger.feltWeakTodayLower', 'Felt weak today, lower the working weight next time…')}
          rows={3}
          maxLength={240}
          className="w-full px-3 py-2 text-sm bg-transparent border border-border rounded-lg outline-none focus:border-foreground/40 resize-none"
        />
      </label>

      {/* The last three sessions, "185×8, 185×8, 185×7". The first of them
          is also each row's Previous; the older two are here for context.
          The machine is named only when it CHANGED from the session before:
          repeating the same one on every line buries the numbers. */}
      {recentSessions.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className={sectionLabel}>{tFallback('exerciseLogger.recentSessions', 'Recent sessions')}</span>
          <div className="flex flex-col gap-1">
            {recentSessions.slice(0, 3).map((session, idx) => {
              const line = formatSetsLine(session.sets);
              if (!line) return null;
              const prev = recentSessions[idx + 1]?.equipment?.label || null;
              const here = session.equipment?.label || null;
              const showMachine = here && here !== prev;
              return (
                <div key={idx} className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                  <History className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span className={idx === 0 ? 'font-semibold text-foreground' : ''}>{line}</span>
                  {showMachine && <span className="truncate">· {here}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
