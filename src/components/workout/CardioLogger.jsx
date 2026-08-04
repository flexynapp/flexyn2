// src/components/workout/CardioLogger.jsx
//
// A cardio entry inside an active workout — added via "+ Cardio". Logs a
// walk / run / bike / swim alongside lifting. Supports multiple SPLITS (e.g.
// interval repeats) via a + inside the card, and — like a lifting exercise —
// collapses to a compact green summary once completed, with Edit to reopen.
//
// Stored on the exercise object as kind:'cardio' with a `segments` array of
// { duration_s, distance_m } (canonical seconds/meters), which rides along in
// the workout's JSONB on save.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Check, Plus, Trash2, Pencil } from 'lucide-react';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { metersTo, toMeters, formatPace, paceSecPerKmFrom } from '@/lib/distanceUnit';
import { triggerHaptic } from '@/lib/haptic';

export const CARDIO_ACTIVITIES = [
  { id: 'walking',  label: 'Walk', emoji: '🚶', name: 'Walking' },
  { id: 'running',  label: 'Run',  emoji: '🏃', name: 'Running' },
  { id: 'cycling',  label: 'Bike', emoji: '🚴', name: 'Cycling' },
  { id: 'swimming', label: 'Swim', emoji: '🏊', name: 'Swimming' },
];

// Gendered emoji variants so the little figure matches the athlete — female if
// they picked "female" in onboarding, male if "male", neutral otherwise.
const EMOJI_BY_GENDER = {
  walking:  { female: '🚶‍♀️', male: '🚶‍♂️', neutral: '🚶' },
  running:  { female: '🏃‍♀️', male: '🏃‍♂️', neutral: '🏃' },
  cycling:  { female: '🚴‍♀️', male: '🚴‍♂️', neutral: '🚴' },
  swimming: { female: '🏊‍♀️', male: '🏊‍♂️', neutral: '🏊' },
};
export function activityEmoji(id, gender) {
  const set = EMOJI_BY_GENDER[id] || EMOJI_BY_GENDER.running;
  return set[gender] || set.neutral;
}

const newSegKey = () => `cs_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

// Read segments, migrating a legacy single duration_s/distance_m entry.
function readSegments(exercise) {
  if (Array.isArray(exercise.segments) && exercise.segments.length) return exercise.segments;
  return [{ _key: newSegKey(), duration_s: exercise.duration_s ?? null, distance_m: exercise.distance_m ?? null }];
}

export default function CardioLogger({ exercise, onChange, gender }) {
  const { distanceUnit } = useDistanceUnit();
  const activity = CARDIO_ACTIVITIES.find(a => a.id === exercise.activity) || CARDIO_ACTIVITIES[1];
  const emoji = activityEmoji(activity.id, gender);
  const segments = readSegments(exercise);
  const completed = !!exercise.completed;

  const totalSec = segments.reduce((s, seg) => s + (Number(seg.duration_s) || 0), 0);
  const totalM = segments.reduce((s, seg) => s + (Number(seg.distance_m) || 0), 0);
  const hasData = totalSec > 0 || totalM > 0;
  const pace = totalM > 0 && totalSec > 0 ? formatPace(paceSecPerKmFrom(totalM, totalSec), distanceUnit) : null;

  const setActivity = (id) => {
    const a = CARDIO_ACTIVITIES.find(x => x.id === id) || activity;
    onChange({ ...exercise, activity: a.id, name: a.name, displayName: a.name });
  };
  const writeSegments = (next) => onChange({ ...exercise, segments: next, duration_s: undefined, distance_m: undefined });
  const updateSegment = (i, patch) => writeSegments(segments.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  const addSplit = () => { triggerHaptic?.('light'); writeSegments([...segments, { _key: newSegKey(), duration_s: null, distance_m: null }]); };
  const removeSplit = (i) => writeSegments(segments.filter((_, idx) => idx !== i));
  const toggleComplete = () => { triggerHaptic?.(completed ? 'light' : 'success'); onChange({ ...exercise, completed: !completed }); };

  // ── Collapsed summary (completed) ────────────────────────────────────────
  if (completed) {
    const summary = [
      segments.length > 1 ? `${segments.length} splits` : null,
      totalM > 0 ? `${metersTo(distanceUnit, totalM).toFixed(2)} ${distanceUnit}` : null,
      totalSec > 0 ? `${Math.round(totalSec / 60)} min` : null,
      pace ? `${pace}` : null,
    ].filter(Boolean).join(' · ');
    return (
      <motion.div initial={{ opacity: 0.6 }} animate={{ opacity: 1 }}>
        <Card className="p-3 border border-success/25 bg-success/[0.06] shadow-none">
          <div className="flex items-center gap-3 pe-6">
            <span className="w-8 h-8 rounded-full bg-success text-white flex items-center justify-center shrink-0">
              <Check className="w-4 h-4" strokeWidth={3} />
            </span>
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm leading-tight truncate">{emoji} {activity.name}</p>
              {summary && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{summary}</p>}
            </div>
            <button
              type="button"
              onClick={toggleComplete}
              className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-lg hover:bg-secondary transition-colors shrink-0"
            >
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
          </div>
        </Card>
      </motion.div>
    );
  }

  // ── Full card ────────────────────────────────────────────────────────────
  return (
    <Card className="p-4 pt-6 border border-info/20 bg-info/[0.03] shadow-sm">
      {/* Activity switcher — extra top padding above so the reorder drag handle
          (top-center grip) has breathing room above the buttons. */}
      <div className="flex items-center gap-2 mb-3 pe-8">
        <span className="text-2xl leading-none shrink-0">{emoji}</span>
        <div className="flex gap-1 flex-1">
          {CARDIO_ACTIVITIES.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => setActivity(a.id)}
              aria-pressed={a.id === activity.id}
              className={[
                'flex-1 h-8 rounded-lg text-xs font-semibold transition-colors',
                a.id === activity.id ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* Split column headers */}
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground px-1 mb-1">
        {segments.length > 1 && <span className="w-6 text-center">#</span>}
        <span className="flex-1 text-center">Duration (min)</span>
        <span className="flex-1 text-center">Distance ({distanceUnit})</span>
        <span className="w-8" />
      </div>

      {/* Split rows */}
      <div className="space-y-1.5">
        <AnimatePresence initial={false}>
          {segments.map((seg, i) => (
            <motion.div
              key={seg._key || `seg_${i}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.18 }}
              style={{ overflow: 'hidden' }}
              className="flex items-center gap-2"
            >
              {segments.length > 1 && <span className="w-6 text-center text-xs text-muted-foreground font-medium">{i + 1}</span>}
              <SegInput
                kind="min"
                seconds={seg.duration_s}
                onCommit={(v) => updateSegment(i, { duration_s: v })}
              />
              <span className="text-muted-foreground text-xs">·</span>
              <SegInput
                kind="dist"
                meters={seg.distance_m}
                unit={distanceUnit}
                onCommit={(v) => updateSegment(i, { distance_m: v })}
              />
              {segments.length > 1 ? (
                <button
                  type="button"
                  onClick={() => removeSplit(i)}
                  aria-label="Remove split"
                  className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors shrink-0"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              ) : (
                <span className="w-8 shrink-0" />
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* + Add split (for interval / brick sessions) */}
      <button
        type="button"
        onClick={addSplit}
        className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
      >
        <Plus className="w-3.5 h-3.5" /> Add split
      </button>

      {pace && (
        <p className="mt-2 text-xs text-muted-foreground">
          Pace <span className="font-semibold text-foreground">{pace}</span>
          <span className="mx-1.5 opacity-40">·</span>
          {Math.round(totalSec / 60)} min · {metersTo(distanceUnit, totalM).toFixed(2)} {distanceUnit}
        </p>
      )}

      {/* Complete cardio — collapses the card to a summary. */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={toggleComplete}
        disabled={!hasData}
        className={[
          'mt-3 w-full inline-flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold transition-colors',
          hasData ? 'bg-success text-white hover:bg-success/90' : 'border border-border text-muted-foreground/60',
        ].join(' ')}
      >
        <Check className="w-4 h-4" strokeWidth={3} /> Complete cardio
      </motion.button>
    </Card>
  );
}

// A duration (minutes) or distance (user-unit) input with local draft state so
// keystrokes aren't reformatted mid-typing; commits canonical seconds/meters.
function SegInput({ kind, seconds, meters, unit, onCommit }) {
  const initial = kind === 'min'
    ? (seconds ? String(Math.round(seconds / 60)) : '')
    : (meters ? metersTo(unit, meters).toFixed(2) : '');
  const [draft, setDraft] = useState(initial);
  React.useEffect(() => { setDraft(initial); /* resync when parent value changes externally */ }, [initial]);

  const commit = (raw) => {
    if (kind === 'min') {
      const m = Math.max(0, Math.min(600, parseInt(raw, 10) || 0));
      onCommit(m * 60 || null);
    } else {
      const v = Math.max(0, parseFloat(raw) || 0);
      onCommit(v > 0 ? Math.round(toMeters(unit, v)) : null);
    }
  };
  return (
    <Input
      type="number"
      inputMode={kind === 'min' ? 'numeric' : 'decimal'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      placeholder={kind === 'min' ? '0' : '0.0'}
      className="h-9 text-center flex-1"
    />
  );
}
