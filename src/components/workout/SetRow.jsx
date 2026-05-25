import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, X, Flame, Gauge, MessageCircle, Minus, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
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
    <div className="relative">
    <div className="flex items-center gap-2">
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
          value={set.weight != null ? formatWeightNumber(set.weight, weightUnit) : ''}
          onChange={e => {
            const raw = e.target.value;
            if (raw === '') {
              onChange({ ...set, weight: null });
            } else {
              const val = parseFloat(raw);
              if (isNaN(val)) { onChange({ ...set, weight: null }); return; }
              const lbs = toLbs(Math.max(0, val), weightUnit);
              const clamped = Math.min(maxWeight, lbs);
              // Audit B-1 — silent clamp was opaque ("I typed 5000 and
              // it shows 500"). Surface a one-shot toast naming the cap
              // so the user knows the system corrected them on purpose.
              if (lbs > maxWeight + 0.5) {
                const capDisplay = formatWeightNumber(maxWeight, weightUnit);
                toast.message(`Capped at ${capDisplay} ${weightUnit}`, {
                  description: 'Anti-cheat: weight exceeds realistic limit for your profile.',
                  duration: 2200,
                });
              }
              onChange({ ...set, weight: clamped });
            }
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
            triggerHaptic?.('light'); // respects per-device haptics toggle (audit B-5)
            toast.success(`Set parsed — ${formatWeightNumber(clampedWeight, weightUnit)} ${weightUnit} × ${clampedReps}`, { duration: 1500 });
          }}
          onKeyDown={e => {
            if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
            if (e.key === 'Enter') { e.preventDefault(); repsRef.current?.focus(); }
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
          className="absolute -top-3 right-0 z-10 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gradient-to-r from-amber-400 to-amber-500 text-amber-950 text-[10px] font-extrabold uppercase tracking-[0.15em] shadow-lg shadow-amber-500/30 pointer-events-none"
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
      {/* Warmup toggle — stored on the set object as is_warmup so the
          XP calculator / volume math can down-weight these. Visual:
          empty flame icon = working set, filled = warmup. */}
      <button
        type="button"
        onClick={() => onChange({ ...set, is_warmup: !set.is_warmup })}
        className={[
          'h-8 w-8 rounded-md flex items-center justify-center shrink-0 transition-colors',
          set.is_warmup
            ? 'bg-orange-500/15 text-orange-500'
            : 'text-muted-foreground/50 hover:text-foreground hover:bg-secondary',
        ].join(' ')}
        aria-label={set.is_warmup ? 'Mark as working set' : 'Mark as warmup'}
        aria-pressed={!!set.is_warmup}
        title={set.is_warmup ? 'Warmup set (lower XP)' : 'Toggle warmup'}
      >
        <Flame className={`w-3.5 h-3.5 ${set.is_warmup ? 'fill-orange-500' : ''}`} />
      </button>
      {/* Failed-set marker — for honest tracking when the user
          attempted but didn't complete the prescribed reps. Excluded
          from PR detection (see SetRow's isPRSet computation above) so
          a missed lift doesn't claim a fake record. */}
      <button
        type="button"
        onClick={() => onChange({ ...set, is_failed: !set.is_failed })}
        className={[
          'h-8 w-8 rounded-md flex items-center justify-center shrink-0 transition-colors text-xs font-extrabold',
          set.is_failed
            ? 'bg-red-500/15 text-red-500'
            : 'text-muted-foreground/50 hover:text-foreground hover:bg-secondary',
        ].join(' ')}
        aria-label={set.is_failed ? 'Mark as completed' : 'Mark set as failed'}
        aria-pressed={!!set.is_failed}
        title={set.is_failed ? 'Failed set' : 'Mark as failed'}
      >
        ✗
      </button>
      {/* Feel/note toggle — opens an inline emoji-picker + short text
          row. Active tint when either field has a value. */}
      <button
        type="button"
        onClick={() => setFeelOpen(o => !o)}
        aria-label={feelOpen ? 'Hide feel row' : 'Show feel row'}
        title="How did this set feel?"
        className={[
          'h-8 w-8 rounded-md flex items-center justify-center shrink-0 transition-colors text-sm',
          hasFeelData
            ? 'bg-purple-500/15 text-purple-400'
            : 'text-muted-foreground/50 hover:text-foreground hover:bg-secondary',
        ].join(' ')}
      >
        {set.feel_emoji || <MessageCircle className="w-3.5 h-3.5" />}
      </button>
      {/* Effort tracking toggle — opens an inline RPE/RIR row. Active
          (tinted) when any effort field has a value so the user sees
          at-a-glance which sets carry effort data. */}
      <button
        type="button"
        onClick={() => setEffortOpen(o => !o)}
        aria-label={effortOpen ? 'Hide effort fields' : 'Show effort fields'}
        title="RPE / RIR"
        className={[
          'h-8 w-8 rounded-md flex items-center justify-center shrink-0 transition-colors',
          hasEffortData
            ? 'bg-blue-500/15 text-blue-500'
            : 'text-muted-foreground/50 hover:text-foreground hover:bg-secondary',
        ].join(' ')}
      >
        <Gauge className="w-3.5 h-3.5" />
      </button>
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onRemove}>
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </Button>
    </div>
    {/* RPE / RIR inline row — optional per-set effort data. RPE is the
        canonical "1-10 how hard was that?" scale; RIR is its mirror
        ("how many more reps could you have done"). Standard in
        evidence-based programming (Renaissance Periodization, etc.). */}
    {effortOpen && (
      <div className="mt-1.5 pl-8 pr-2 space-y-1.5">
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
      <div className="flex items-center gap-2 mt-1.5 pl-8 pr-2">
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