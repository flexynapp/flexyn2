// src/components/dashboard/SleepLogCard.jsx
//
// One-tap daily sleep logger — the missing input for the Readiness score,
// which reads getTodaySleepLog but previously had no UI to feed it (sleep
// was a ghost feature: upsertSleepLog existed with zero callers).
//
// Hours is the primary, required signal (recovery weights sleep duration
// heaviest); quality is an optional second tap. Mirrors MoodLogCard's
// robustness: optimistic update, ref-based in-flight guard, midnight tick
// on the query key, and an unmounted guard. On save it invalidates the
// shared ['sleepLogToday', userId] key so ReadinessCard recomputes live.

import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from '@/lib/toast';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { upsertSleepLog, getTodaySleepLog } from '@/lib/data/sleepLogs';

// Quick-pick hours. Buckets keep it one-tap; the stored value is a
// reasonable midpoint so the recovery curve gets a usable number.
const HOURS = [
  { label: '<5', value: 4.5 },
  { label: '6', value: 6 },
  { label: '7', value: 7 },
  { label: '8', value: 8 },
  { label: '9+', value: 9.5 },
];
const QUALITY_LABELS = ['Poor', 'Fair', 'OK', 'Good', 'Great'];

const hoursLabelFor = (h) => {
  if (h == null) return null;
  const match = HOURS.find((o) => o.value === h);
  return match ? match.label : `${h}h`;
};

export default function SleepLogCard() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(false);
  const [optHours, setOptHours] = useState(null);
  const [optQuality, setOptQuality] = useState(null);
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Local date key drives the query so a PWA left open across midnight
  // rolls to the new day (same pattern as MoodLogCard).
  const computeTodayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [todayDateKey, setTodayDateKey] = useState(computeTodayKey);
  useEffect(() => {
    const id = setInterval(() => {
      const next = computeTodayKey();
      setTodayDateKey((prev) => (prev === next ? prev : next));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const { data: today } = useQuery({
    queryKey: ['sleepLogToday', user?.id, todayDateKey],
    queryFn: getTodaySleepLog,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  // Sync optimistic from server unless a save is in flight.
  useEffect(() => {
    if (submittingRef.current) return;
    if (today?.hours != null) setOptHours(today.hours);
    if (today?.quality != null) setOptQuality(today.quality);
  }, [today?.hours, today?.quality]);

  const hours = optHours ?? today?.hours ?? null;
  const quality = optQuality ?? today?.quality ?? null;

  // Save hours and/or quality. hours is required by upsertSleepLog, so a
  // quality-only tap carries the current hours along. Partial upserts
  // preserve the untouched column (ON CONFLICT updates only sent columns).
  const save = async ({ nextHours, nextQuality }) => {
    if (submittingRef.current) return;
    const effHours = nextHours ?? hours;
    if (effHours == null) {
      toast.error(tFallback('sleep.needHours', 'Pick your hours first.'));
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    const priorHours = optHours;
    const priorQuality = optQuality;
    if (nextHours != null) setOptHours(nextHours);
    if (nextQuality != null) setOptQuality(nextQuality);
    try {
      const res = await upsertSleepLog({
        hours: effHours,
        quality: nextQuality ?? quality ?? undefined,
      });
      if (!mountedRef.current) return;
      if (res.ok) {
        // Prefix-invalidate so ReadinessCard (['sleepLogToday', userId])
        // and this card both refetch and the score recomputes.
        qc.invalidateQueries({ queryKey: ['sleepLogToday', user?.id] });
      } else {
        setOptHours(priorHours);
        setOptQuality(priorQuality);
        toast.error(tFallback('sleep.saveFailed', 'Could not save sleep — try again.'));
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(false);
    }
  };

  if (!user?.id) return null;

  const logged = hours != null;
  const summary = logged
    ? `${hoursLabelFor(hours)}h${quality != null ? ` · ${tFallback(`sleep.quality.${quality}`, QUALITY_LABELS[Math.max(1, Math.min(5, quality)) - 1])}` : ''}`
    : null;

  return (
    <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }} className="h-full">
      <Card className="px-3 py-2 h-full flex flex-col justify-center gap-1.5">
        <p className="text-micro font-bold tracking-[0.04em] text-muted-foreground">
          {summary || tFallback('sleep.prompt', "Last night's sleep")}
        </p>

        {/* hours — required primary signal */}
        <div className="flex items-center justify-between gap-1" role="radiogroup" aria-label={tFallback('sleep.hoursAria', 'Hours slept')}>
          {HOURS.map((o) => {
            const active = hours === o.value;
            return (
              <button
                key={o.label}
                type="button"
                disabled={submitting}
                onClick={() => save({ nextHours: o.value })}
                role="radio"
                aria-checked={active}
                aria-label={tFallback('sleep.hoursLabel', `${o.label} hours`)}
                className={[
                  'flex-1 min-w-[44px] min-h-[36px] rounded-lg text-xs font-bold tabular-nums transition-transform flex items-center justify-center',
                  active ? 'bg-primary/15 text-primary scale-105' : 'bg-secondary text-muted-foreground hover:text-foreground hover:scale-105',
                ].join(' ')}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        {/* Quality dots removed — redundant with the hours score above. */}
      </Card>
    </motion.div>
  );
}
