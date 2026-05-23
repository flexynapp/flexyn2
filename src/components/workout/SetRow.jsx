import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Trophy, X, Flame, Gauge } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { getMaxRealisticWeight, getMaxRealisticReps } from '@/lib/realisticLimits';
import { useWeightUnit } from '../../lib/WeightUnitContext';
import { toLbs, formatWeightNumber } from '../../lib/weightUnit';
import { useLanguage } from '@/lib/LanguageContext';
import { parseSetInput } from '@/lib/parseSetInput';
import { epleyOneRepMax } from '@/lib/oneRepMax';
import PRProximityBar from './PRProximityBar';
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

export default function SetRow({ set, index, onChange, onRemove, exerciseName = '', userProfile = {}, prIndex = {} }) {
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
  const isPRSet = priorBest > 0 && liveEstimate > priorBest;

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
      <div className="flex-1">
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
              const lbs = isNaN(val) ? null : toLbs(Math.max(0, val), weightUnit);
              onChange({ ...set, weight: lbs == null ? null : Math.min(maxWeight, lbs) });
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
            try { navigator.vibrate?.(10); } catch { /* ignore */ }
            toast.success('Set parsed', { duration: 1200 });
          }}
          onKeyDown={e => {
            if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
          }}
          placeholder={weightUnit}
          className="h-9 text-center"
        />
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
              onChange({ ...set, reps: isNaN(val) ? null : Math.min(maxReps, Math.max(0, val)) });
            }
          }}
          onKeyDown={e => {
            if (['-', '+', 'e', 'E'].includes(e.key)) e.preventDefault();
          }}
          placeholder={t('common.reps')}
          className="h-9 text-center"
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
      <div className="flex items-center gap-2 mt-1.5 pl-8 pr-2">
        <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          RPE
        </label>
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
          placeholder="1–10"
          className="h-7 text-center text-xs flex-1"
        />
        <label className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
          RIR
        </label>
        <Input
          type="number"
          min="0"
          max="10"
          inputMode="numeric"
          value={set.rir ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (v === '') return onChange({ ...set, rir: null });
            const num = parseInt(v, 10);
            if (Number.isNaN(num)) return;
            onChange({ ...set, rir: Math.max(0, Math.min(10, num)) });
          }}
          placeholder="0–5"
          className="h-7 text-center text-xs flex-1"
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
      <p className="text-[10px] text-muted-foreground pl-8 mt-0.5 leading-none">
        {plates.map(({ count, plate }) => `${count}×${plate}`).join(' + ')} per side
      </p>
    )}
    </div>
  );
}