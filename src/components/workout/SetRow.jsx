import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trophy, Flame, Gauge, MessageCircle, Minus, Plus, Check, Trash2, MoreHorizontal } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { toast } from '@/lib/toast';
import { getMaxRealisticWeight, getMaxRealisticReps } from '@/lib/realisticLimits';
import { useWeightUnit } from '../../lib/WeightUnitContext';
import { toLbs, formatWeightNumber } from '../../lib/weightUnit';
import { useLanguage } from '@/lib/LanguageContext';
import { parseSetInput } from '@/lib/parseSetInput';
import { epleyOneRepMax } from '@/lib/oneRepMax';
import { triggerHaptic } from '@/lib/haptic';
import PRProximityBar from './PRProximityBar';
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

export default function SetRow({ set, index, onChange, onRemove, exerciseName = '', userProfile = {}, prIndex = {}, isBodyweight = false, prevFeelNote = '' }) {
  const { weightUnit } = useWeightUnit();
  const { t } = useLanguage();
  const maxWeight = getMaxRealisticWeight(exerciseName, userProfile);
  const maxReps = getMaxRealisticReps(exerciseName, set.weight || 0, userProfile);

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
        description: 'Anti-cheat: weight exceeds realistic limit for your profile.',
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
  const toggleComplete = () => {
    triggerHaptic?.(completed ? 'light' : 'success');
    onChange({ ...set, completed: !completed });
    if (completed) return;
    setMoreOpen(false); // collapse the tag drawer once a set is locked in
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
  const wasPRRef = React.useRef(isPRSet);
  const [showPRFlash, setShowPRFlash] = useState(false);
  React.useEffect(() => {
    if (!wasPRRef.current && isPRSet) {
      setShowPRFlash(true);
      const id = setTimeout(() => setShowPRFlash(false), 2500);
      wasPRRef.current = true;
      return () => clearTimeout(id);
    }
    if (!isPRSet) wasPRRef.current = false;
    return undefined;
  }, [isPRSet]);

  return (
    <div className={['relative rounded-lg transition-colors', completed ? 'bg-emerald-500/[0.06]' : ''].join(' ')}>
    <div className={['flex items-center gap-2 transition-opacity', completed ? 'opacity-95' : ''].join(' ')}>
      <span className="text-xs text-muted-foreground w-6 text-center font-medium">{index + 1}</span>
      <div className="flex-1 flex items-center gap-0.5">
        {/* Stepper buttons for progressive overload — one-tap bumps
            of the unit-appropriate small plate (5 lb / 2.5 kg). The
            kg increment matches the smallest standard plate pair.
            Tap +/- repeatedly to nudge; the value is clamped to the
            same maxWeight that direct typing respects. */}
        {(() => {
          const stepLbs = weightUnit === 'kg' ? 2.5 / 0.453592 : 5;
          const currentLbs = Number(set.weight) || 0;
          const bump = (delta) => {
            const next = Math.max(0, Math.min(maxWeight, currentLbs + delta));
            onChange({ ...set, weight: next });
          };
          return (
            <>
              <button
                type="button"
                tabIndex={-1}
                aria-label="Decrease weight"
                onClick={() => bump(-stepLbs)}
                className="w-6 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors shrink-0"
              >
                <Minus className="w-3 h-3" />
              </button>
            </>
          );
        })()}
        <Input
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
          className={`h-9 text-center transition-shadow ${isPRSet ? 'ring-2 ring-amber-400/60 shadow-[0_0_12px_rgba(251,191,36,0.4)]' : ''}`}
          aria-label={isBodyweight ? 'Added weight (bodyweight exercise)' : `Weight in ${weightUnit}`}
        />
        {(() => {
          const stepLbs = weightUnit === 'kg' ? 2.5 / 0.453592 : 5;
          const currentLbs = Number(set.weight) || 0;
          const bumpUp = () => {
            const next = Math.max(0, Math.min(maxWeight, currentLbs + stepLbs));
            onChange({ ...set, weight: next });
          };
          return (
            <button
              type="button"
              tabIndex={-1}
              aria-label="Increase weight"
              onClick={bumpUp}
              className="w-6 h-9 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors shrink-0"
            >
              <Plus className="w-3 h-3" />
            </button>
          );
        })()}
      </div>
      <span className="text-muted-foreground text-xs">×</span>
      <div className="flex-1">
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
                  description: 'Anti-cheat: rep count exceeds realistic limit at that weight.',
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
          className={`h-9 text-center transition-shadow ${isPRSet ? 'ring-2 ring-amber-400/60 shadow-[0_0_12px_rgba(251,191,36,0.4)]' : ''}`}
        />
      </div>
      {/* Prominent "NEW PR" flash — slides in for ~2.5s on the
          false→true PR edge, then fades back to the tiny inline
          trophy below for at-a-glance reads. The two are layered:
          flash is absolute-positioned above the row, the trophy
          stays inline so the post-flash state still reads as PR. */}
      {showPRFlash && (
        <motion.span
          initial={{ x: -10, opacity: 0, scale: 0.9 }}
          animate={{ x: 0, opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ type: 'spring', stiffness: 380, damping: 18 }}
          className="absolute -top-3 end-0 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 text-[10px] font-extrabold uppercase tracking-[0.15em] shadow-lg shadow-amber-500/30 pointer-events-none"
          aria-live="polite"
        >
          🎉 New PR
        </motion.span>
      )}
      {/* PR auto-tag — inline trophy between reps and delete. Springs
          in when the set crosses the all-time PR threshold. */}
      {isPRSet && (
        <motion.span
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 480, damping: 20 }}
          className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-amber-400/15 text-amber-400 shrink-0"
          aria-label="New PR pace"
          title="New PR pace"
        >
          <Trophy className="w-3.5 h-3.5" />
        </motion.span>
      )}
      {/* Active-tag chips — keep set state readable at a glance while the
          warmup/failed/feel/RPE controls live behind the ⋯ drawer. */}
      {!moreOpen && (set.is_warmup || set.is_failed || hasFeelData || hasEffortData) && (
        <div className="flex items-center gap-1 shrink-0">
          {set.is_warmup && <TagDot className="bg-orange-500/15 text-orange-500"><Flame className="w-3 h-3" /></TagDot>}
          {set.is_failed && <TagDot className="bg-red-500/15 text-red-500 text-[11px] font-extrabold">✗</TagDot>}
          {hasFeelData && <TagDot className="bg-purple-500/15 text-purple-400 text-xs">{set.feel_emoji || <MessageCircle className="w-3 h-3" />}</TagDot>}
          {hasEffortData && <TagDot className="bg-blue-500/15 text-blue-500 text-[10px] font-bold">{set.rpe != null ? set.rpe : set.rir}</TagDot>}
        </div>
      )}
      {/* ⋯ — secondary options drawer (warmup / failed / feel / RPE / delete) */}
      <button
        type="button"
        onClick={() => setMoreOpen(o => !o)}
        aria-label="More set options"
        aria-expanded={moreOpen}
        className={[
          'h-8 w-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
          moreOpen ? 'bg-secondary text-foreground' : 'text-muted-foreground/50 hover:text-foreground hover:bg-secondary',
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
          'h-9 w-9 rounded-xl flex items-center justify-center shrink-0 transition-all',
          completed
            ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-500/30'
            : 'border-2 border-border text-muted-foreground/40 hover:border-emerald-500/50 hover:text-emerald-500',
        ].join(' ')}
      >
        <motion.span key={completed ? 'on' : 'off'} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 17 }}>
          <Check className="w-4 h-4" strokeWidth={3} />
        </motion.span>
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
            <TagButton active={!!set.is_warmup} onClick={() => onChange({ ...set, is_warmup: !set.is_warmup })} activeCls="bg-orange-500/15 text-orange-500" icon={<Flame className="w-3.5 h-3.5" />} label="Warmup" />
            <TagButton active={!!set.is_failed} onClick={() => onChange({ ...set, is_failed: !set.is_failed })} activeCls="bg-red-500/15 text-red-500" icon={<span className="text-xs font-extrabold leading-none">✗</span>} label="Failed" />
            <TagButton active={hasFeelData} onClick={() => setFeelOpen(o => !o)} activeCls="bg-purple-500/15 text-purple-400" icon={set.feel_emoji ? <span className="text-sm leading-none">{set.feel_emoji}</span> : <MessageCircle className="w-3.5 h-3.5" />} label="Feel" />
            <TagButton active={hasEffortData} onClick={() => setEffortOpen(o => !o)} activeCls="bg-blue-500/15 text-blue-500" icon={<Gauge className="w-3.5 h-3.5" />} label="RPE" />
            <button
              type="button"
              onClick={onRemove}
              aria-label="Delete set"
              className="h-8 w-8 ms-auto rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-red-500 hover:bg-red-500/10 transition-colors shrink-0"
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
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground w-8 shrink-0">RIR</span>
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
                      ? 'bg-blue-500 text-white'
                      : 'bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground',
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
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground w-8 shrink-0">RPE</span>
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
            placeholder="1–10 (optional)"
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
                set.feel_emoji === em ? 'bg-purple-500/20' : 'opacity-60 hover:opacity-100'
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
    <PRProximityBar
      exerciseName={exerciseName}
      weight={set.weight}
      reps={set.reps}
      prIndex={prIndex}
    />
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
        active ? activeCls : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
      ].join(' ')}
    >
      <span className="flex items-center justify-center w-4 h-4">{icon}</span>
      {label}
    </button>
  );
}