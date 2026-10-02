// src/components/nutrition/FastingTrackerCard.jsx
//
// Intermittent-fasting tracker card for the Nutrition page. Two states:
//
//   • Not fasting → "Start fast" CTA with a small preset picker
//     (16:8, 18:6, OMAD 20:4) plus a manual-hours input for any
//     custom duration the user wants.
//   • In a fast    → live countdown ring + start time + "End fast"
//     button. Auto-detects "done" when elapsed >= target.
//
// Local-only via fastingWindow.js — no schema change.

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Hourglass, StopCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Glyph, MealPlateIcon } from '@/components/nutrition/NutrientIcon';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import {
  readState,
  startFast,
  endFast,
  computeProgress,
  formatCountdown,
} from '@/lib/fastingWindow';
import { useLanguage } from '@/lib/LanguageContext';
import { formatDate } from '@/lib/intl';

// `id` is the key slug as well as the React key. 'OMAD' rather than '20:4'
// because a colon in a key path reads as a namespace separator to half the
// tooling here, the same way a hyphen does.
const PRESETS = [
  { id: '16_8', hours: 16, label: '16:8', desc: 'Most popular' },
  { id: '18_6', hours: 18, label: '18:6', desc: 'Tight window' },
  { id: 'omad', hours: 20, label: '20:4', desc: 'One meal a day' },
];

/**
 * A 24-hour dial with the EATING window filled — 8h, 6h and 4h wedges
 * shrinking across the three preset buttons.
 *
 * "16:8" and "18:6" are only legible if you already know the convention;
 * the shrinking wedge says which window is tighter without needing it. It
 * fills the eating window rather than the fast because that's the part the
 * user is choosing, and a nearly-full circle on every preset would show no
 * difference between them.
 */
function FastWindowDial({ eatingHours, className = 'w-5 h-5' }) {
  const CX = 12, CY = 12, R = 8.5;
  const sweep = (eatingHours / 24) * 360;
  // Start at 12 o'clock. SVG angles run clockwise from the +x axis, so
  // noon is -90deg.
  const point = (deg) => {
    const rad = (deg * Math.PI) / 180;
    return [CX + R * Math.cos(rad), CY + R * Math.sin(rad)];
  };
  const [x0, y0] = point(-90);
  const [x1, y1] = point(-90 + sweep);
  const largeArc = sweep > 180 ? 1 : 0;
  return (
    <Glyph className={className}>
      <circle cx={CX} cy={CY} r={R} />
      <path
        d={`M${CX} ${CY}L${x0} ${y0}A${R} ${R} 0 ${largeArc} 1 ${x1} ${y1}Z`}
        fill="currentColor"
        stroke="none"
      />
    </Glyph>
  );
}

export default function FastingTrackerCard() {
  const { language, tFallback } = useLanguage();
  const { user } = useAuth();
  const [state, setState] = useState(() => readState(user?.email));
  const [, tick] = useState(0);
  // Manual-hours input. Inline under the preset row so the user can
  // type any duration without leaving the card.
  const [customHours, setCustomHours] = useState('');

  // 1Hz ticker while a fast is in progress so the countdown updates.
  useEffect(() => {
    if (!state?.startedAt) return undefined;
    const id = setInterval(() => tick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [state?.startedAt]);

  const handleStart = (hours) => {
    const next = startFast(user?.email, hours);
    setState(next);
    toast.success(tFallback('fastingTrackerCard.started', 'Fasting clock started · {h}h target.', { h: hours }));
  };
  const handleStartCustom = () => {
    const n = Number(customHours);
    if (!Number.isFinite(n) || n <= 0 || n > 48) {
      toast.error(tFallback('fastingTrackerCard.durationRange', 'Enter a fasting duration between 1 and 48 hours.'));
      return;
    }
    handleStart(n);
    setCustomHours('');
  };
  const handleEnd = () => {
    endFast(user?.email);
    setState(null);
    toast.success(tFallback('fastingTrackerCard.fastEnded', 'Fast ended.'));
  };

  if (!state) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Hourglass className="w-4 h-4 shrink-0 text-primary" />
          <h3 className="font-heading font-bold text-sm">{tFallback("fastingTrackerCard.intermittentFasting", "Intermittent fasting")}</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          {tFallback(
            'fastingTrackerCard.intro',
            'Pick a preset or set your own duration. It tracks your eating window without nagging.',
          )}
        </p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleStart(p.hours)}
              className="rounded-lg border border-border bg-secondary/30 hover:bg-secondary/60 active:bg-secondary/60 px-2 py-2 flex flex-col items-center text-center transition-colors"
            >
              <FastWindowDial eatingHours={24 - p.hours} className="w-5 h-5 mb-1 text-primary" />
              <p className="font-heading font-bold text-sm">{p.label}</p>
              <p className="text-micro text-muted-foreground">{tFallback(`fastingTrackerCard.preset.${p.id}`, p.desc)}</p>
            </button>
          ))}
        </div>
        {/* Manual-hours input — for users who want a duration the
            presets don't cover (e.g. 14h, 22h, 24h). */}
        <div className="flex items-center gap-2">
          <label className="kicker shrink-0">
            {tFallback("nutrition.water.custom", "Custom")}
          </label>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="48"
            placeholder={tFallback('cardio.voice.hours', 'hours')}
            value={customHours}
            onChange={e => setCustomHours(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleStartCustom(); }}
            className="flex-1 min-w-0 h-8 rounded-md border border-border bg-secondary/30 px-2 text-sm tabular-nums focus:outline-none focus:border-primary/50"
            aria-label={tFallback("fastingTrackerCard.customFastingHours", "Custom fasting hours")}
          />
          <button
            type="button"
            onClick={handleStartCustom}
            disabled={!customHours}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            {tFallback("cardio.live.start", "Start")}
          </button>
        </div>
      </div>
    );
  }

  const { remainingMs, pct, done } = computeProgress(state.startedAt, state.targetHours);
  const dashArray = 2 * Math.PI * 36;
  const dashOffset = dashArray * (1 - pct / 100);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {/* The header icon carries the state change too, not just the
              wording — a plate the moment the window opens. */}
          {done
            ? <MealPlateIcon className="w-4 h-4 shrink-0 text-emerald-500" />
            : <Hourglass className="w-4 h-4 shrink-0 text-primary" />}
          <h3 className="font-heading font-bold text-sm">
            {done
              ? tFallback('fastingTrackerCard.windowOpen', 'Eating window open')
              : tFallback('fastingTrackerCard.fasting', 'Fasting')}
          </h3>
        </div>
        <span className="kicker">
          {tFallback('fastingTrackerCard.hourTarget', '{h}h target', { h: state.targetHours })}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative w-20 h-20 shrink-0">
          <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
            <circle cx="40" cy="40" r="36" fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="6" />
            <motion.circle
              cx="40" cy="40" r="36"
              fill="none"
              stroke={done ? '#10b981' : '#f97316'}
              strokeWidth="6"
              strokeLinecap="round"
              strokeDasharray={dashArray}
              animate={{ strokeDashoffset: dashOffset }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {/* An hourglass, not a Play triangle — the ring is counting a
                fast down, and Play read as "press me to start". */}
            {done ? <Check className="w-6 h-6 text-emerald-500" /> : <Hourglass className="w-5 h-5 text-orange-500" />}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading text-xl font-bold tabular-nums leading-none">
            {done ? tFallback('fastingTrackerCard.open', 'OPEN') : formatCountdown(remainingMs)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            {tFallback('fastingTrackerCard.startedAt', 'Started {t}', {
              t: formatDate(state.startedAt, language, { hour: 'numeric', minute: '2-digit' }),
            })}
          </p>
          <Button
            size="sm"
            variant={done ? 'default' : 'outline'}
            onClick={handleEnd}
            className="mt-2 h-8 px-3 text-xs"
          >
            <StopCircle className="w-3.5 h-3.5 me-1" /> {tFallback("fastingTrackerCard.endFast", "End fast")}
          </Button>
        </div>
      </div>
    </div>
  );
}
