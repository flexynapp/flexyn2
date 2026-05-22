import React from 'react';
import { motion } from 'framer-motion';
import { Trophy, X, Flame } from 'lucide-react';
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

const BAR_LBS = 45; // standard barbell; TODO: make configurable per settings

function plateCalc(weightLbs, barLbs = BAR_LBS) {
  if (!weightLbs || weightLbs < barLbs) return null;
  const PLATES = [45, 35, 25, 10, 5, 2.5];
  let perSide = (weightLbs - barLbs) / 2;
  const result = [];
  for (const plate of PLATES) {
    if (perSide >= plate) {
      const count = Math.floor(perSide / plate);
      result.push({ count, plate });
      perSide = Math.round((perSide - count * plate) * 100) / 100;
    }
  }
  return result.length > 0 ? result : null;
}

export default function SetRow({ set, index, onChange, onRemove, exerciseName = '', userProfile = {}, prIndex = {} }) {
  const { weightUnit } = useWeightUnit();
  const { t } = useLanguage();
  const maxWeight = getMaxRealisticWeight(exerciseName, userProfile);
  const maxReps = getMaxRealisticReps(exerciseName, set.weight || 0, userProfile);

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

  return (
    <div>
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
      <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={onRemove}>
        <X className="w-3.5 h-3.5 text-muted-foreground" />
      </Button>
    </div>
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