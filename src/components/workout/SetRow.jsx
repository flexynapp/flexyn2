import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Flame, Gauge, MessageCircle, Trash2, MoreHorizontal } from 'lucide-react';
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

export default function SetRow({ set, index, onChange, onRemove, exerciseName = '', userProfile = {}, prIndex = {}, isBodyweight = false, prevFeelNote = '', previous = null }) {
  const { weightUnit } = useWeightUnit();
  const { t, tFallback } = useLanguage();
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

  // Effort-tracking fields (RPE / RIR) are stored on the set object
  // alongside weight + reps. Hidden by default behind a small chevron
  // so the row stays compact for users who don't track effort. The
  // expand-state persists across sets via a session-only flag that
  // lights up when ANY of the fields has a value.
  const hasEffortData = (set.rpe != null && set.rpe !== '') || (set.rir != null && set.rir !== '');
  const [effortOpen, setEffortOpen] = useState(hasEffortData);

  // Per-set "feel" — short emoji + freeform note. Stored on the set
  // object alongside RPE/RIR. Hidden behind a toggle to keep the
  // collapsed row scannable.
  const hasFeelData = !!(set.feel_emoji || set.feel_note);
  // Auto-open the feel row (and surface the previous set's note as
  // placeholder) when an earlier set carried a cue — so an execution
  // note like "watch elbow flare" stays in front of the lifter for the
  // rest of the exercise without retyping.
  const [feelOpen, setFeelOpen] = useState(hasFeelData || !!prevFeelNote);

  // Secondary tags (warmup / failed / feel / RPE / delete) live behind a single
  // "⋯" disclosure so the row shows one clear action instead of a wall of icons.
  const [moreOpen, setMoreOpen] = useState(false);

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
  const toggleComplete = () => {
    triggerHaptic?.(completed ? 'light' : 'success');
    onChange({ ...set, completed: !completed });
    if (completed) { setJustDone(0); return; }
    setJustDone(Date.now());
    setMoreOpen(false); // collapse the tag drawer once a set is locked in
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
  const plates = plateCalc(set.weight);
  const showPlates = plates && exerciseName && /barbell|squat|deadlift|bench|press|row|clean|snatch/i.test(exerciseName);

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

  const doneInput = completed ? 'bg-transparent border-transparent text-success font-semibold' : '';

  return (
    <div className={['relative rounded-lg transition-colors duration-300', completed ? 'bg-success/[0.12]' : ''].join(' ')}>
    {/* The sweep: a green fill that runs across the row once, then fades,
        leaving the settled tint behind it. */}
    <AnimatePresence>
      {justDone > 0 && (
        <motion.span
          key={justDone}
          aria-hidden="true"
          className="absolute inset-0 rounded-lg bg-success pointer-events-none origin-left rtl:origin-right"
          initial={{ scaleX: 0, opacity: 0.5 }}
          animate={{ scaleX: 1, opacity: [0.5, 0.5, 0] }}
          exit={{ opacity: 0 }}
          transition={{ scaleX: { duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }, opacity: { duration: 0.75, times: [0, 0.6, 1] } }}
        />
      )}
    </AnimatePresence>
    <div className="relative flex items-center gap-1.5 p-1">
      <span className={['text-xs w-6 text-center font-bold tabular-nums transition-colors', completed ? 'text-success' : 'text-muted-foreground'].join(' ')}>{index + 1}</span>
      <button
        type="button"
        onClick={usePrevious}
        disabled={!previousLabel || completed}
        aria-label={previousLabel ? `${tFallback('setRow.usePrevious', 'Use last time')}: ${previousLabel}` : undefined}
        className="flex-1 min-w-0 h-11 text-start text-xs tabular-nums text-muted-foreground truncate rounded-md px-1 enabled:hover:text-foreground enabled:active:text-foreground transition-colors"
      >
        {previousLabel || '·'}
      </button>
      <div className="relative w-[4.5rem] shrink-0">
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
          className={`w-full h-11 px-1 text-center tabular-nums transition-colors ${doneInput}`}
          aria-label={isBodyweight ? 'Added weight (bodyweight exercise)' : `Weight in ${weightUnit}`}
        />
      </div>
      <div className="w-14 shrink-0">
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
          className={`h-11 px-1 text-center tabular-nums transition-colors ${doneInput}`}
        />
      </div>
      {/* PR stamp. Pinned over the weight field's corner so it never
          takes a column; springs in on the edge, then stays. */}
      {isPRSet && (
        <motion.span
          initial={prFresh ? { scale: 2.2, rotate: -14, opacity: 0 } : false}
          animate={{ scale: 1, rotate: -6, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 18 }}
          className="absolute top-0 end-[12rem] z-10 px-1.5 py-px rounded-md bg-success text-success-foreground text-micro font-extrabold tracking-wide pointer-events-none"
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
        {justDone > 0 && gainLabel && (
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
      {/* Active-tag chips — keep set state readable at a glance while the
          warmup/failed/feel/RPE controls live behind the ⋯ drawer. */}
      {!moreOpen && (set.is_warmup || set.is_failed || hasFeelData || hasEffortData) && (
        <div className="flex items-center gap-1 shrink-0">
          {set.is_warmup && <TagDot className="bg-primary/15 text-primary"><Flame className="w-3 h-3" /></TagDot>}
          {set.is_failed && <TagDot className="bg-destructive/15 text-destructive text-micro font-extrabold">✗</TagDot>}
          {hasFeelData && <TagDot className="bg-primary/15 text-primary text-xs">{set.feel_emoji || <MessageCircle className="w-3 h-3" />}</TagDot>}
          {hasEffortData && <TagDot className="bg-info/15 text-info text-micro font-bold">{set.rpe != null ? set.rpe : set.rir}</TagDot>}
        </div>
      )}
      {/* ⋯ — secondary options drawer (warmup / failed / feel / RPE / delete) */}
      <button
        type="button"
        onClick={() => setMoreOpen(o => !o)}
        aria-label={tFallback("setRow.moreSetOptions", "More set options")}
        aria-expanded={moreOpen}
        className={[
          'h-11 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
          moreOpen ? 'bg-secondary text-foreground' : 'text-muted-foreground/50 hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary',
        ].join(' ')}
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {/* ✓ Done — the primary per-set action. Fills green with a spring pop. */}
      <button
        type="button"
        onClick={toggleComplete}
        aria-label={completed ? 'Mark set not done' : 'Complete set'}
        aria-pressed={completed}
        className={[
          'h-11 w-11 rounded-lg flex items-center justify-center shrink-0 transition-colors',
          completed
            ? 'bg-success text-success-foreground'
            : 'bg-secondary text-muted-foreground hover:text-success active:text-success',
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
          initial={completed ? { scale: 0.7 } : false}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 520, damping: 16 }}
        >
          <motion.path
            d="M5 12l5 5L20 7"
            initial={completed ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.28, delay: 0.05, ease: 'easeOut' }}
          />
        </motion.svg>
      </button>
    </div>

    {/* Secondary tag drawer — the relocated warmup/failed/feel/RPE/delete
        controls, now labeled so the standalone icon legend isn't needed. */}
    <AnimatePresence initial={false}>
      {moreOpen && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18 }}
          style={{ overflow: 'hidden' }}
        >
          <div className="flex items-center gap-1.5 mt-2 ps-8 pe-1">
            <TagButton active={!!set.is_warmup} onClick={() => onChange({ ...set, is_warmup: !set.is_warmup })} activeCls="bg-primary/15 text-primary" icon={<Flame className="w-3.5 h-3.5" />} label="Warmup" />
            <TagButton active={!!set.is_failed} onClick={() => onChange({ ...set, is_failed: !set.is_failed })} activeCls="bg-destructive/15 text-destructive" icon={<span className="text-xs font-extrabold leading-none">✗</span>} label="Failed" />
            <TagButton active={hasFeelData} onClick={() => setFeelOpen(o => !o)} activeCls="bg-primary/15 text-primary" icon={set.feel_emoji ? <span className="text-sm leading-none">{set.feel_emoji}</span> : <MessageCircle className="w-3.5 h-3.5" />} label="Feel" />
            <TagButton active={hasEffortData} onClick={() => setEffortOpen(o => !o)} activeCls="bg-info/15 text-info" icon={<Gauge className="w-3.5 h-3.5" />} label="RPE" />
            <button
              type="button"
              onClick={onRemove}
              aria-label={tFallback("setRow.deleteSet", "Delete set")}
              className="h-8 w-8 ms-auto rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-destructive active:text-destructive hover:bg-destructive/10 active:bg-destructive/10 transition-colors shrink-0"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
    {/* RPE / RIR inline row — optional per-set effort data. RPE is the
        canonical "1-10 how hard was that?" scale; RIR is its mirror
        ("how many more reps could you have done"). Standard in
        evidence-based programming (Renaissance Periodization, etc.). */}
    {effortOpen && (
      <div className="mt-1.5 ps-8 pe-2 space-y-1.5">
        {/* RIR — one-tap chips (reps in reserve). Tap to tag, tap the
            active chip again to clear. Feeds intensity into the Nemesis
            / auto-pilot engines, not just raw volume. */}
        <div className="flex items-center gap-1.5">
          <span className="text-micro font-bold uppercase tracking-wide text-muted-foreground w-8 shrink-0">RIR</span>
          <div className="flex gap-1 flex-1">
            {RIR_OPTIONS.map(({ v, label }) => {
              const active = set.rir != null && Number(set.rir) === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => { triggerHaptic?.('light'); onChange({ ...set, rir: active ? null : v }); }}
                  aria-pressed={active}
                  aria-label={`RIR ${label}`}
                  className={[
                    'flex-1 h-7 rounded-md text-xs font-bold transition-colors',
                    active
                      ? 'bg-info text-white'
                      : 'bg-secondary/60 text-muted-foreground hover:bg-secondary active:bg-secondary hover:text-foreground active:text-foreground',
                  ].join(' ')}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        {/* RPE — precise optional input (1–10, half-steps) for lifters who
            prefer the perceived-exertion scale. */}
        <div className="flex items-center gap-1.5">
          <span className="text-micro font-bold uppercase tracking-wide text-muted-foreground w-8 shrink-0">RPE</span>
          <Input
            type="number"
            min="1"
            max="10"
            step="0.5"
            inputMode="decimal"
            value={set.rpe ?? ''}
            onChange={(e) => {
              const v = e.target.value;
              if (v === '') return onChange({ ...set, rpe: null });
              const num = parseFloat(v);
              if (Number.isNaN(num)) return;
              onChange({ ...set, rpe: Math.max(1, Math.min(10, num)) });
            }}
            placeholder={tFallback("setRow.110Optional", "1–10 (optional)")}
            className="h-7 text-center text-xs flex-1"
          />
        </div>
      </div>
    )}
    {/* Per-set feel — quick emoji palette + freeform note. Stored as
        set.feel_emoji + set.feel_note so each set carries its own
        signal (RPE captures effort; this captures the more-subjective
        "how did that go" the user can scan back through later). */}
    {feelOpen && (
      <div className="flex items-center gap-2 mt-1.5 ps-8 pe-2">
        <div className="flex items-center gap-0.5 shrink-0">
          {FEEL_EMOJI_SET.map(em => (
            <button
              key={em}
              type="button"
              onClick={() =>
                onChange({ ...set, feel_emoji: set.feel_emoji === em ? null : em })
              }
              className={`text-base px-1 py-0.5 rounded transition-colors ${
                set.feel_emoji === em ? 'bg-primary/20' : 'opacity-60 hover:opacity-100'
              }`}
              aria-label={`Feel ${em}`}
              aria-pressed={set.feel_emoji === em}
            >
              {em}
            </button>
          ))}
        </div>
        <Input
          type="text"
          value={set.feel_note ?? ''}
          onChange={(e) => onChange({ ...set, feel_note: e.target.value.slice(0, 80) || null })}
          placeholder={prevFeelNote || 'Note (optional)'}
          maxLength={80}
          className="h-7 text-xs flex-1"
        />
      </div>
    )}
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
    </div>
  );
}

// Tiny at-a-glance tag indicator shown on the collapsed row.
function TagDot({ className = '', children }) {
  return (
    <span className={`h-5 min-w-[20px] px-1 rounded-md flex items-center justify-center leading-none ${className}`}>
      {children}
    </span>
  );
}

// Labeled toggle inside the ⋯ drawer — the label removes the need for a
// separate icon legend.
function TagButton({ active, onClick, activeCls, icon, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={[
        'h-8 px-2.5 rounded-lg flex items-center gap-1.5 text-xs font-semibold transition-colors shrink-0',
        active ? activeCls : 'text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary',
      ].join(' ')}
    >
      <span className="flex items-center justify-center w-4 h-4">{icon}</span>
      {label}
    </button>
  );
}