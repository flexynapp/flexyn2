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
import { Timer, Play, StopCircle, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import {
  readState,
  startFast,
  endFast,
  computeProgress,
  formatCountdown,
} from '@/lib/fastingWindow';

const PRESETS = [
  { id: '16:8',  hours: 16, label: '16:8',  desc: 'Most popular' },
  { id: '18:6',  hours: 18, label: '18:6',  desc: 'Tight window' },
  { id: 'OMAD',  hours: 20, label: '20:4',  desc: 'One meal a day' },
];

export default function FastingTrackerCard() {
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
    toast.success(`Fasting clock started · ${hours}h target.`);
  };
  const handleStartCustom = () => {
    const n = Number(customHours);
    if (!Number.isFinite(n) || n <= 0 || n > 48) {
      toast.error('Enter a fasting duration between 1 and 48 hours.');
      return;
    }
    handleStart(n);
    setCustomHours('');
  };
  const handleEnd = () => {
    endFast(user?.email);
    setState(null);
    toast.success('Fast ended.');
  };

  if (!state) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center gap-2 mb-2">
          <Timer className="w-4 h-4 text-primary" />
          <h3 className="font-heading font-bold text-sm">Intermittent fasting</h3>
        </div>
        <p className="text-xs text-muted-foreground mb-3">
          Pick a preset or set your own duration — tracks your eating window without nagging.
        </p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => handleStart(p.hours)}
              className="rounded-lg border border-border bg-secondary/30 hover:bg-secondary/60 px-2 py-2 text-center transition-colors"
            >
              <p className="font-heading font-bold text-sm">{p.label}</p>
              <p className="text-[10px] text-muted-foreground">{p.desc}</p>
            </button>
          ))}
        </div>
        {/* Manual-hours input — for users who want a duration the
            presets don't cover (e.g. 14h, 22h, 24h). */}
        <div className="flex items-center gap-2">
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold shrink-0">
            Custom
          </label>
          <input
            type="number"
            inputMode="numeric"
            min="1"
            max="48"
            placeholder="hours"
            value={customHours}
            onChange={e => setCustomHours(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleStartCustom(); }}
            className="flex-1 min-w-0 h-8 rounded-md border border-border bg-secondary/30 px-2 text-sm tabular-nums focus:outline-none focus:border-primary/50"
            aria-label="Custom fasting hours"
          />
          <button
            type="button"
            onClick={handleStartCustom}
            disabled={!customHours}
            className="h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-bold disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            Start
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
          <Timer className="w-4 h-4 text-primary" />
          <h3 className="font-heading font-bold text-sm">
            {done ? 'Eating window open' : 'Fasting'}
          </h3>
        </div>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {state.targetHours}h target
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
            {done ? <Check className="w-6 h-6 text-emerald-500" /> : <Play className="w-5 h-5 text-orange-500" />}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading text-xl font-bold tabular-nums leading-none">
            {done ? 'OPEN' : formatCountdown(remainingMs)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Started {new Date(state.startedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
          <Button
            size="sm"
            variant={done ? 'default' : 'outline'}
            onClick={handleEnd}
            className="mt-2 h-8 px-3 text-xs"
          >
            <StopCircle className="w-3.5 h-3.5 me-1" /> End fast
          </Button>
        </div>
      </div>
    </div>
  );
}
