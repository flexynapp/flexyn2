import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform, animate, useReducedMotion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { getMaxRealisticWeight, getMaxRealisticReps } from '@/lib/realisticLimits';
import { useWeightUnit } from '../../lib/WeightUnitContext';
import { toLbs, formatWeightNumber, formatWeight } from '../../lib/weightUnit';
import { useLanguage } from '@/lib/LanguageContext';
import { parseSetInput } from '@/lib/parseSetInput';
import { epleyOneRepMax } from '@/lib/oneRepMax';
import { triggerHaptic } from '@/lib/haptic';
import PRProximityBar, { prProximityPct } from './PRProximityBar';
import OneShotTooltip from '@/components/OneShotTooltip';
import { TOOLTIP } from '@/lib/tooltipRegistry';
import PlateDiagram from './PlateDiagram';
import { getActiveBarLbs, platesPerSide } from '@/lib/barInventory';

// Plate calculator reads the user's active bar from barInventory.js
// (configurable per device — defaults to 45lb Olympic). Replaces the
// previous hardcoded 45lb assumption; gym women's bars, EZ-curl,
// trap bars, training bars all need different math.
function plateCalc(weightLbs) {
  const result = platesPerSide(weightLbs, getActiveBarLbs());
  if (!result || result.length === 0) return null;
  return result;
}

// RIR (reps-in-reserve) quick-tag chips. One-tap labeling instead of
// typing a number — 0 = taken to failure, 5+ = plenty left in the tank.
const RIR_OPTIONS = [
  { v: 0, label: '0' },
  { v: 1, label: '1' },
  { v: 2, label: '2' },
  { v: 3, label: '3' },
  { v: 4, label: '4' },
  { v: 5, label: '5+' },
];

// RPE chips: the working range. Below 6 is a warm-up in all but name.
const RPE_OPTIONS = [6, 7, 8, 9, 10];

// How far a set row must travel before letting go deletes it. Past a
// thumb's casual drift, short of the whole row: a deliberate swipe.
const SWIPE_DELETE_PX = 88;

export default function SetRow({ set, index, onChange, onRemove, exerciseName = '', userProfile = {}, prIndex = {}, isBodyweight = false, prevFeelNote = '', previous = null, isNext = false, isCurrent = false }) {
  const { weightUnit } = useWeightUnit();
  const { t, tFallback } = useLanguage();
  // Every tap presses to 97% and the check pops with a spring, unless the
  // phone asks for reduced motion, in which case nothing moves.
  const reduceMotion = useReducedMotion();
  const tap = reduceMotion ? undefined : { scale: 0.97 };
  const maxWeight = getMaxRealisticWeight(exerciseName, userProfile);
  const maxReps = getMaxRealisticReps(exerciseName, set.weight || 0, userProfile);

  // ── One-shot hints ────────────────────────────────────────────────────────
  // Both of these were registered in tooltipRegistry.js and never mounted, so
  // two real features shipped with nothing teaching them. Smart paste in
  // particular is undiscoverable by definition — nobody pastes "225 x 8" into
  // a number field to see what happens.
  //
  // Anchored on the FIRST set row only (`index === 0`). SetRow renders once
  // per set, and while hasSeenTooltip() would stop the 2nd..Nth from firing,
  // mounting a portal per set to have it immediately no-op is waste on the
  // hottest screen in the app.
  const weightInputRef = useRef(null);
  const proximityRef = useRef(null);
  const isFirstSet = index === 0;

  // The PR bar renders nothing below 70% of the user's best, so the hint has
  // to mount only when there is actually a bar to point at — OneShotTooltip's
  // effect fires once on mount and will not re-run when the anchor appears
  // later. Same predicate the bar itself uses, so the two cannot disagree.
  const proximityPct = prProximityPct({ exerciseName, weight: set.weight, reps: set.reps, prIndex });

  // Weight input — local raw-string state WHILE FOCUSED so the user's
  // keystrokes aren't re-formatted mid-typing. The stored value is
  // canonical lbs; the display value is formatted into the user's unit
  // (kg / stone) with a fixed decimal count. Re-running formatWeightNumber
  // on every keystroke meant typing "82" in kg mode round-tripped through
  // lbs and back to "8.0" (one decimal place), so the field fought the
  // user. We now show the raw string verbatim while editing and only
  // parse → convert → clamp → format on blur. (Audit task 7.)
  const [weightFocused, setWeightFocused] = useState(false);
  const [weightDraft, setWeightDraft] = useState('');
  const commitWeight = (raw) => {
    if (raw === '' || raw == null) { onChange({ ...set, weight: null }); return; }
    const val = parseFloat(raw);
    if (Number.isNaN(val)) { onChange({ ...set, weight: null }); return; }
    const lbs = toLbs(Math.max(0, val), weightUnit);
    const clamped = Math.min(maxWeight, lbs);
    if (lbs > maxWeight + 0.5) {
      const capDisplay = formatWeightNumber(maxWeight, weightUnit);
      toast.message(`Capped at ${capDisplay} ${weightUnit}`, {
        description: tFallback('setRow.antiCheatWeight', 'Anti-cheat: weight exceeds realistic limit for your profile.'),
        duration: 2200,
      });
    }
    onChange({ ...set, weight: clamped });
  };

  // Effort and feel live in the set options sheet now (tap the set
  // number). They are still stored on the set object: rpe / rir for
  // effort, feel_emoji / feel_note for the subjective read.
  const [optionsOpen, setOptionsOpen] = useState(false);
  const openOptions = () => { triggerHaptic?.('light'); setOptionsOpen(true); };

  // Swipe toward the row's end edge to delete: left in LTR, right in RTL.
  // It is the gesture every lifting app has taught people; the labelled
  // Delete set in the options sheet is the other door. ExerciseLogger's
  // removeSet puts up an Undo, so a swipe that goes too far costs one tap.
  // The motion value drives the red strip behind the row so it is exactly
  // as wide as the gap the row has moved out of.
  const isRtl = typeof document !== 'undefined' && document.documentElement.dir === 'rtl';
  const swipeSign = isRtl ? 1 : -1;
  const dragX = useMotionValue(0);
  const swipedRef = useRef(false);
  const revealWidth = useTransform(dragX, v => Math.max(0, v * swipeSign));
  const revealOpacity = useTransform(dragX, v => Math.min(1, Math.max(0, (v * swipeSign) / 32)));
  const onSwipeEnd = (_e, info) => {
    // The click (if any) lands after dragEnd; clear the flag once it has had
    // its chance, so a later plain tap is not swallowed.
    setTimeout(() => { swipedRef.current = false; }, 0);
    const dist = info.offset.x * swipeSign;
    const speed = info.velocity.x * swipeSign;
    if (dist > SWIPE_DELETE_PX || (dist > 40 && speed > 500)) {
      triggerHaptic?.('medium');
      onRemove?.();
      return;
    }
    animate(dragX, 0, reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 600, damping: 40 });
  };

  // Completion — the lifter taps ✓ Done when a set is actually finished. This
  // is the primary per-set action; it drives the exercise-completion gate.
  const completed = !!set.completed;
  // `justDone` drives the one-second moment after a check: a green sweep
  // across the row, the check drawing itself, and what the set added to
  // the session floating up. It is keyed so a quick undo and redo replays
  // it rather than resuming a half-finished animation.
  const [justDone, setJustDone] = useState(0);
  useEffect(() => {
    if (!justDone) return undefined;
    const id = setTimeout(() => setJustDone(0), 1100);
    return () => clearTimeout(id);
  }, [justDone]);
  // One short 10ms tick on the check, the app's 'primary' pattern, through
  // the haptics helper so the per-device off switch and reduced motion are
  // respected. Unticking is lighter still.
  const toggleComplete = () => {
    triggerHaptic?.(completed ? 'light' : 'primary');
    onChange({ ...set, completed: !completed });
    if (completed) { setJustDone(0); return; }
    setJustDone(Date.now());
  };
  const setVolumeLbs = (Number(set.weight) || 0) * (Number(set.reps) || 0);
  const gainLabel = setVolumeLbs > 0
    ? `+${formatWeight(setVolumeLbs, weightUnit)}`
    : (Number(set.reps) > 0 ? `+${set.reps} ${t('common.reps')}` : null);

  // "Previous": what this set was last session. Tapping it copies both
  // numbers into the row, which is how most sets get logged.
  const previousLabel = previous && (previous.weight != null || previous.reps != null)
    ? `${previous.weight != null && Number(previous.weight) > 0 ? formatWeightNumber(previous.weight, weightUnit) : (isBodyweight ? 'BW' : '0')} × ${previous.reps ?? 0}`
    : null;
  const usePrevious = () => {
    if (!previous || completed) return;
    const w = previous.weight != null ? Math.min(maxWeight, Math.max(0, Number(previous.weight) || 0)) : set.weight;
    const r = previous.reps != null ? Math.max(0, Number(previous.reps) || 0) : set.reps;
    triggerHaptic?.('light');
    onChange({ ...set, weight: w, reps: r });
  };

  // Auto-advance: confirming the weight (Enter / keyboard "next") jumps
  // focus to reps so the logging flow keeps moving when hands are sweaty.
  const repsRef = React.useRef(null);
  const FEEL_EMOJI_SET = ['💪', '🔥', '😤', '😐', '😩', '💀', '🤕'];

  // Plate calculator — shown for barbell exercises when weight ≥ bar weight
  // set.weight is always stored internally in lbs
  // Only on the set about to be lifted: that is the one being loaded. A
  // diagram under every row doubled each row's height, so an iPhone SE
  // showed about two sets before scrolling.
  const plates = plateCalc(set.weight);
  const showPlates = isNext && plates && exerciseName && /barbell|squat|deadlift|bench|press|row|clean|snatch/i.test(exerciseName);

  // PR auto-tag — render a trophy when THIS set's estimated 1RM
  // beats the user's all-time best for this exercise. Visible during
  // the workout, BEFORE save — so the user gets the receipt in the
  // moment, not 30 seconds later when the celebration toast fires.
  const priorBest = prIndex[(exerciseName || '').trim().toLowerCase()] || 0;
  const liveEstimate = epleyOneRepMax(set.weight, set.reps);
  // PR detection skips warmups + failed sets — a missed lift
  // shouldn't claim a fake record.
  const isPRSet = priorBest > 0
    && liveEstimate > priorBest
    && !set.is_warmup
    && !set.is_failed;

  // Flash a prominent "NEW PR 🎉" pill on the false→true edge so the
  // user sees the win in real time. We keep the small inline trophy
  // too for the at-a-glance read once the flash fades.
  // The stamp springs in on the false→true edge and then stays put, so
  // the row keeps saying PR for the rest of the session.
  const wasPRRef = React.useRef(isPRSet);
  const [prFresh, setPrFresh] = useState(false);
  React.useEffect(() => {
    if (!wasPRRef.current && isPRSet) {
      setPrFresh(true);
      triggerHaptic?.('success');
      wasPRRef.current = true;
      const id = setTimeout(() => setPrFresh(false), 600);
      return () => clearTimeout(id);
    }
    if (!isPRSet) wasPRRef.current = false;
    return undefined;
  }, [isPRSet]);

  // A logged set reads as settled text rather than as a form: no box, bold.
  const doneInput = completed ? 'bg-transparent border-transparent text-foreground font-bold' : '';

  // The number slot says what kind of set this is: W for a warm-up, F for
  // a failed set, otherwise its position. It is also the door to the set
  // options sheet, which replaced the ⋯ that sat beside ✓ and looked just
  // like it.
  const setKind = set.is_failed ? 'failed' : (set.is_warmup ? 'warmup' : 'working');
  const slotLabel = setKind === 'failed'
    ? tFallback('setRow.failedShort', 'F')
    : setKind === 'warmup' ? tFallback('setRow.warmupShort', 'W') : String(index + 1);
  const chooseKind = (kind) => {
    triggerHaptic?.('light');
    onChange({ ...set, is_warmup: kind === 'warmup', is_failed: kind === 'failed' });
  };

  return (
    <div
      data-next-outline={isCurrent && !completed ? 'true' : undefined}
      className={[
        'relative rounded-lg transition-colors duration-300',
        completed ? 'bg-success/10' : '',
        // The set you are on, once the exercise is under way. A neutral
        // outline: orange belongs to this row's ✓, the one thing to press.
        isCurrent && !completed ? 'ring-1 ring-inset ring-foreground/50' : '',
      ].join(' ')}
    >
    {/* The sweep: a green fill that runs across the row once, then fades,
        leaving the settled tint behind it. */}
    <AnimatePresence>
      {justDone > 0 && !reduceMotion && (
        <motion.span
          key={justDone}
          aria-hidden="true"
          className="absolute inset-0 rounded-lg bg-success pointer-events-none origin-left rtl:origin-right"
          initial={{ scaleX: 0, opacity: 0.4 }}
          animate={{ scaleX: 1, opacity: [0.4, 0.4, 0] }}
          exit={{ opacity: 0 }}
          transition={{ scaleX: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }, opacity: { duration: 0.75, times: [0, 0.6, 1] } }}
        />
      )}
    </AnimatePresence>
    <div className="relative">
    {/* Revealed behind the row as it is swiped away. */}
    <motion.div
      aria-hidden="true"
      className="absolute inset-y-0 end-0 rounded-lg bg-destructive text-destructive-foreground flex items-center justify-end pe-4 overflow-hidden whitespace-nowrap pointer-events-none"
      style={{ width: revealWidth, opacity: revealOpacity }}
    >
      <span className="flex items-center gap-1.5 text-xs font-bold shrink-0">
        <Trash2 className="w-4 h-4" />
        {tFallback('common.delete', 'Delete')}
      </span>
    </motion.div>
    <motion.div
      className="relative flex items-center gap-1 p-1"
      drag="x"
      dragDirectionLock
      dragMomentum={false}
      dragElastic={0}
      dragConstraints={isRtl ? { left: 0, right: 160 } : { left: -160, right: 0 }}
      style={{ x: dragX }}
      onDragStart={() => { swipedRef.current = true; }}
      onDragEnd={onSwipeEnd}
      onClickCapture={(e) => {
        // A swipe that ends over the set number or ✓ must not also press it.
        if (swipedRef.current) { e.stopPropagation(); e.preventDefault(); swipedRef.current = false; }
      }}
    >
      <motion.button
        type="button"
        whileTap={tap}
        onClick={openOptions}
        aria-haspopup="dialog"
        aria-expanded={optionsOpen}
        aria-label={tFallback('setRow.setOptions', 'Set {n} options', { n: index + 1 })}
        className={[
          'h-11 w-11 shrink-0 rounded-lg flex items-center justify-center text-sm font-extrabold tabular-nums transition-colors hover:bg-secondary active:bg-secondary',
          completed ? 'text-success' : (setKind === 'working' ? 'text-foreground' : 'text-muted-foreground'),
        ].join(' ')}
      >
        {slotLabel}
      </motion.button>
      {previousLabel ? (
        <motion.button
          type="button"
          whileTap={completed ? undefined : tap}
          onClick={usePrevious}
          disabled={completed}
          aria-label={`${tFallback('setRow.usePrevious', 'Use last time')}: ${previousLabel}`}
          className="flex-1 min-w-0 h-11 text-start text-xs tabular-nums text-muted-foreground truncate px-1 enabled:underline enabled:decoration-dotted enabled:decoration-border enabled:underline-offset-4 enabled:hover:text-foreground enabled:active:text-foreground transition-colors"
        >
          {previousLabel}
        </motion.button>
      ) : (
        <span className="flex-1 min-w-0" aria-hidden="true" />
      )}
      <div className="relative w-16 shrink-0">
        <Input
          ref={weightInputRef}
          type="number"
          inputMode="decimal"
          value={weightFocused ? weightDraft : (set.weight != null ? formatWeightNumber(set.weight, weightUnit) : '')}
          onChange={e => {
            // While focused, hold the raw keystrokes verbatim — no
            // parse/format round-trip until blur (commitWeight). (Task 7.)
            setWeightDraft(e.target.value);
          }}
          onBlur={() => {
            commitWeight(weightDraft);
            setWeightFocused(false);
          }}
          onPaste={e => {
            // Smart-paste: if the user pastes a "225 x 8" / "100kg 12 reps"
            // shaped string, fill BOTH weight and reps in one tap. Lifters
            // write down sets this way in notes apps; we meet them where
            // they already are. Falls through to normal paste when the
            // input doesn't match a set shape.
            const text = e.clipboardData?.getData('text');
            const parsed = parseSetInput(text);
            if (!parsed) return;
            e.preventDefault();
            const sourceUnit = parsed.unit === 'kg' ? 'kg'
                             : parsed.unit === 'lb' ? 'lbs'
                             : weightUnit;
            const lbs = toLbs(parsed.weight, sourceUnit);
            const clampedWeight = Math.min(maxWeight, Math.max(0, lbs));
            const clampedReps = Math.min(maxReps, Math.max(0, parsed.reps));
            onChange({ ...set, weight: clampedWeight, reps: clampedReps });
            // Keep the focused-draft in sync so the just-pasted weight
            // isn't clobbered by the stale draft on the next render. (Task 7.)
            setWeightDraft(formatWeightNumber(clampedWeight, weightUnit));
            triggerHaptic?.('light'); // respects per-device haptics toggle (audit B-5)
            toast.success(`Set parsed — ${formatWeightNumber(clampedWeight, weightUnit)} ${weightUnit} × ${clampedReps}`, { duration: 1500 });
          }}
          onKeyDown={e => {
            if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
            // Enter commits the draft (so the canonical value is parsed)
            // before advancing focus to reps. (Task 7.)
            if (e.key === 'Enter') { e.preventDefault(); commitWeight(weightDraft); setWeightFocused(false); repsRef.current?.focus(); }
          }}
          onFocus={e => {
            // Seed the raw draft from the current canonical value (formatted
            // into the user's unit) and switch to draft mode so keystrokes
            // are held verbatim. (Task 7.)
            setWeightDraft(set.weight != null ? formatWeightNumber(set.weight, weightUnit) : '');
            setWeightFocused(true);
            // Scroll the focused input into the visible viewport above the
            // iOS soft keyboard. Without this, tapping a weight input
            // mid-page pushes the field BEHIND the keyboard so the user
            // can't see what they're typing — the exact "If you type,
            // you cannot see what you're typing" bug from screenshot
            // feedback. Two-pass with a 250ms delay catches iOS Safari's
            // post-keyboard layout settle.
            const el = e.currentTarget;
            try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* noop */ }
            setTimeout(() => {
              try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* noop */ }
            }, 250);
          }}
          enterKeyHint="next"
          placeholder={isBodyweight ? `+ ${weightUnit}` : weightUnit}
          className={`w-full h-11 px-1 text-center tabular-nums placeholder:text-sm transition-colors ${doneInput}`}
          aria-label={isBodyweight ? 'Added weight (bodyweight exercise)' : `Weight in ${weightUnit}`}
        />
      </div>
      <div className="w-12 shrink-0">
        <Input
          type="number"
          inputMode="numeric"
          value={set.reps ?? ''}
          onChange={e => {
            const raw = e.target.value;
            if (raw === '') {
              onChange({ ...set, reps: null });
            } else {
              const val = parseInt(raw);
              if (isNaN(val)) { onChange({ ...set, reps: null }); return; }
              const clean = Math.max(0, val);
              const clamped = Math.min(maxReps, clean);
              // Audit B-1 — surface the rep clamp the same way as weight.
              if (clean > maxReps) {
                toast.message(`Capped at ${maxReps} reps`, {
                  description: tFallback('setRow.antiCheatReps', 'Anti-cheat: rep count exceeds realistic limit at that weight.'),
                  duration: 2200,
                });
              }
              onChange({ ...set, reps: clamped });
            }
          }}
          onKeyDown={e => {
            if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
          }}
          onFocus={e => {
            // Same iOS keyboard-coverage fix as the weight input above.
            const el = e.currentTarget;
            try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* noop */ }
            setTimeout(() => {
              try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch { /* noop */ }
            }, 250);
          }}
          ref={repsRef}
          enterKeyHint="done"
          placeholder={t('common.reps')}
          aria-label={t('common.reps')}
          className={`h-11 px-1 text-center tabular-nums placeholder:text-sm transition-colors ${doneInput}`}
        />
      </div>
      {/* PR stamp. Pinned over the weight field's corner so it never
          takes a column; springs in on the edge, then stays. */}
      {isPRSet && (
        <motion.span
          initial={prFresh && !reduceMotion ? { scale: 2.2, rotate: -14, opacity: 0 } : false}
          animate={{ scale: 1, rotate: -6, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 18 }}
          className="absolute top-0 end-[8.5rem] z-10 px-1.5 py-px rounded-sm bg-success text-success-foreground text-micro font-extrabold tracking-wide pointer-events-none"
          aria-label={tFallback('setRow.newPr', 'New personal record')}
          role="status"
        >
          PR
        </motion.span>
      )}
      {/* What this set just added to the session, floating up and away.
          It rises only a little: the row sits in an overflow-hidden
          wrapper (for its height animation), so a longer flight clips. */}
      <AnimatePresence>
        {justDone > 0 && gainLabel && !reduceMotion && (
          <motion.span
            key={justDone}
            aria-hidden="true"
            className="absolute top-3 end-12 z-10 px-2 py-0.5 rounded-full bg-success text-success-foreground text-xs font-extrabold tabular-nums pointer-events-none"
            initial={{ opacity: 0, y: 6, scale: 0.9 }}
            animate={{ opacity: [0, 1, 1, 0], y: [6, 0, -6, -14], scale: [0.9, 1.1, 1, 1] }}
            transition={{ duration: 1.1, times: [0, 0.2, 0.55, 1], ease: 'easeOut' }}
          >
            {gainLabel}
          </motion.span>
        )}
      </AnimatePresence>
      {/* ✓ Done: the only filled control on the card. Idle it is an
          outline, orange on the set to lift next and muted on the rest;
          done it fills green and the check pops in on a spring. */}
      <motion.button
        type="button"
        whileTap={tap}
        onClick={toggleComplete}
        aria-label={completed ? 'Mark set not done' : 'Complete set'}
        aria-pressed={completed}
        className={[
          'h-11 w-11 rounded-lg flex items-center justify-center shrink-0 transition-colors duration-200',
          completed
            ? 'bg-success text-success-foreground border border-success'
            : isNext
              ? 'border-2 border-primary text-primary'
              : 'border border-border text-muted-foreground hover:text-foreground active:text-foreground',
        ].join(' ')}
      >
        <motion.svg
          key={completed ? 'on' : 'off'}
          viewBox="0 0 24 24"
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          initial={completed && !reduceMotion ? { scale: 0.4 } : false}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 600, damping: 12 }}
        >
          <motion.path
            d="M5 12l5 5L20 7"
            initial={completed && !reduceMotion ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.28, delay: 0.05, ease: 'easeOut' }}
          />
        </motion.svg>
      </motion.button>
    </motion.div>
    </div>

    {/* PR proximity bar — visible at >=70% of PR. Renders nothing
        below that threshold so warmup sets stay quiet. */}
    <div ref={proximityRef}>
      <PRProximityBar
        exerciseName={exerciseName}
        weight={set.weight}
        reps={set.reps}
        prIndex={prIndex}
      />
    </div>

    {/* Registered in tooltipRegistry.js and, until now, never mounted —
        so the bar appeared with nothing explaining it. Gated on the bar
        actually rendering (proximityPct != null) rather than on a ref
        null-check, because OneShotTooltip's effect runs once on mount
        and will not re-run when the anchor shows up later. */}
    {proximityPct != null && (
      <OneShotTooltip id={TOOLTIP.PR_PROXIMITY_BAR} anchorRef={proximityRef} placement="top">
        {tFallback('workout.tooltip.prProximity',
          'This bar tracks how close this set is to your best.')}
      </OneShotTooltip>
    )}

    {/* Smart paste. First set row only — see the note at the top. */}
    {isFirstSet && (
      <OneShotTooltip id={TOOLTIP.WORKOUT_SMART_PASTE} anchorRef={weightInputRef} placement="bottom">
        {tFallback('workout.tooltip.smartPaste',
          'Paste "225 x 8" here to fill weight and reps at once.')}
      </OneShotTooltip>
    )}
    {showPlates && (
      <PlateDiagram plates={plates} barLbs={getActiveBarLbs()} />
    )}

    {/* Set options: what kind of set this was, how hard it felt, and
        Delete. One sheet behind the set number instead of a ⋯ drawer and
        two inline rows under the set. */}
    <BottomSheet
      open={optionsOpen}
      onClose={() => setOptionsOpen(false)}
      title={tFallback('setRow.setTitle', 'Set {n}', { n: index + 1 })}
    >
      <div className="px-4 pb-6 flex flex-col gap-6">
        {previousLabel && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {tFallback('setRow.lastTime', '{value} last time', { value: previousLabel })}
          </p>
        )}
        <div role="radiogroup" aria-label={tFallback('setRow.setType', 'Set type')} className="grid grid-cols-3 gap-2">
          {[
            ['working', tFallback('setRow.working', 'Working')],
            ['warmup', tFallback('setRow.warmup', 'Warmup')],
            ['failed', tFallback('setRow.failed', 'Failed')],
          ].map(([kind, label]) => (
            <OptionChip key={kind} role="radio" active={setKind === kind} onClick={() => chooseKind(kind)} tap={tap}>
              {label}
            </OptionChip>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">
            {tFallback('setRow.howHard', 'How hard')}
          </p>
          {/* RPE, the 1 to 10 "how hard was that" scale. Tap the active
              value again to clear it. */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs font-semibold text-muted-foreground">RPE</span>
            <div className="flex gap-1 flex-1">
              {RPE_OPTIONS.map(v => {
                const active = set.rpe != null && Number(set.rpe) === v;
                return (
                  <OptionChip key={v} active={active} tap={tap} ariaLabel={`RPE ${v}`}
                    onClick={() => { triggerHaptic?.('light'); onChange({ ...set, rpe: active ? null : v }); }}>
                    {v}
                  </OptionChip>
                );
              })}
            </div>
          </div>
          {/* RIR, its mirror: how many more reps were left. Feeds intensity
              into the Nemesis and auto pilot engines, not just volume. */}
          <div className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-xs font-semibold text-muted-foreground leading-tight">
              {tFallback('setRow.repsLeft', 'Reps left')}
            </span>
            <div className="flex gap-1 flex-1">
              {RIR_OPTIONS.map(({ v, label }) => {
                const active = set.rir != null && Number(set.rir) === v;
                return (
                  <OptionChip key={v} active={active} tap={tap} ariaLabel={`RIR ${label}`}
                    onClick={() => { triggerHaptic?.('light'); onChange({ ...set, rir: active ? null : v }); }}>
                    {label}
                  </OptionChip>
                );
              })}
            </div>
          </div>
        </div>

        {/* Feel: an emoji and a short note. The previous set's note shows
            as the placeholder, so a cue like "watch elbow flare" follows
            the lifter through the exercise without retyping. */}
        <div className="flex flex-col gap-2">
          <p className="text-micro font-bold uppercase tracking-wide text-muted-foreground">
            {tFallback('setRow.feel', 'Feel')}
          </p>
          <div className="flex items-center gap-1">
            {FEEL_EMOJI_SET.map(em => (
              <OptionChip key={em} active={set.feel_emoji === em} tap={tap} ariaLabel={`Feel ${em}`}
                onClick={() => onChange({ ...set, feel_emoji: set.feel_emoji === em ? null : em })}>
                <span className="text-base leading-none">{em}</span>
              </OptionChip>
            ))}
          </div>
          <Input
            type="text"
            value={set.feel_note ?? ''}
            onChange={(e) => onChange({ ...set, feel_note: e.target.value.slice(0, 80) || null })}
            placeholder={prevFeelNote || tFallback('setRow.notePlaceholder', 'Note (optional)')}
            aria-label={tFallback('setRow.note', 'Note')}
            maxLength={80}
            className="h-11 text-sm"
          />
        </div>

        <div className="pt-2 border-t border-border">
          <motion.button
            type="button"
            whileTap={tap}
            onClick={() => { setOptionsOpen(false); onRemove?.(); }}
            className="w-full min-h-11 gap-3 px-3 rounded-lg flex items-center text-sm font-semibold text-destructive hover:bg-destructive/10 active:bg-destructive/10 transition-colors [&>svg]:size-4 [&>svg]:shrink-0"
          >
            <Trash2 aria-hidden="true" />
            {tFallback('setRow.deleteSet', 'Delete set')}
          </motion.button>
        </div>
      </div>
    </BottomSheet>
    </div>
  );
}


// One neutral chip for every choice in the options sheet. Hairline at rest,
// the secondary surface when chosen. No hue: orange belongs to the one
// acting control on screen, and a tag is not that.
function OptionChip({ active, onClick, children, role, ariaLabel, tap }) {
  return (
    <motion.button
      type="button"
      whileTap={tap}
      onClick={onClick}
      role={role}
      {...(role === 'radio' ? { 'aria-checked': active } : { 'aria-pressed': active })}
      aria-label={ariaLabel}
      className={[
        'flex-1 min-w-0 min-h-11 px-1 rounded-lg border flex items-center justify-center text-sm transition-colors',
        active
          ? 'bg-secondary border-foreground/25 text-foreground font-semibold'
          : 'border-border text-foreground font-medium hover:bg-secondary active:bg-secondary',
      ].join(' ')}
    >
      {children}
    </motion.button>
  );
}
