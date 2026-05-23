// src/components/dashboard/MoodLogCard.jsx
//
// One-tap daily mood logger. Five emoji buttons (😩 😐 🙂 😄 🔥),
// per-day upsert via mood_logs (migration 096). After logging, the
// card shrinks to a "logged" pill showing today's choice — gives the
// user closure without occupying full real estate after the action.

import React, { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { upsertMoodLog, getTodayMoodLog, MOOD_EMOJIS, MOOD_LABELS } from '@/lib/data/moodLogs';

export default function MoodLogCard() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [submitting, setSubmitting] = useState(null);
  const [optimistic, setOptimistic] = useState(null);
  // Ref-based in-flight guard matches the DailyQuestsCard / GoalsAlmostComplete
  // pattern. The `submitting` state-based check has a single-render race
  // window where a fast tap-then-tap-different-emoji could slip through
  // before React applies the state. upsertMoodLog is idempotent on
  // (user_id, date) so a slipped second call wouldn't corrupt data, but
  // the guard avoids the duplicate RPC + the brief optimistic flicker.
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  const { data: today } = useQuery({
    queryKey: ['moodLogToday', user?.id],
    queryFn: getTodayMoodLog,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  // Sync optimistic value if a stale-time-old refetch arrives.
  useEffect(() => {
    if (today?.mood) setOptimistic(today.mood);
  }, [today?.mood]);

  const handleTap = async (mood) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(mood);
    setOptimistic(mood); // optimistic
    try {
      const res = await upsertMoodLog({ mood });
      if (!mountedRef.current) return; // bail if unmounted mid-request
      if (res.ok) {
        qc.invalidateQueries({ queryKey: ['moodLogToday', user?.id] });
      } else {
        setOptimistic(today?.mood ?? null); // revert
        toast.error(tFallback('mood.saveFailed', 'Could not save mood — try again.'));
      }
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setSubmitting(null);
    }
  };

  if (!user?.id) return null;

  const current = optimistic ?? today?.mood ?? null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="h-full"
    >
      <Card className="px-4 py-3 h-full flex items-center">
        <div className="flex items-center justify-between gap-2 w-full">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {tFallback('mood.kicker', 'Today')}
            </p>
            <p className="text-sm font-heading font-bold leading-tight mt-0.5">
              {current
                ? tFallback(`mood.label.${current}`, MOOD_LABELS[current - 1])
                : tFallback('mood.prompt', 'How are you feeling?')}
            </p>
          </div>
          <div
            className="flex items-center gap-1 shrink-0"
            role="radiogroup"
            aria-label={tFallback('mood.aria', 'Log your mood')}
          >
            {MOOD_EMOJIS.map((emoji, i) => {
              const mood = i + 1;
              const isActive = current === mood;
              const isBusy = submitting === mood;
              return (
                <button
                  key={mood}
                  type="button"
                  onClick={() => handleTap(mood)}
                  role="radio"
                  aria-checked={isActive}
                  aria-label={MOOD_LABELS[i]}
                  className={[
                    'w-9 h-9 rounded-full text-lg transition-transform flex items-center justify-center',
                    isActive
                      ? 'bg-primary/15 scale-110'
                      : 'opacity-50 hover:opacity-100 hover:scale-110',
                    isBusy ? 'animate-pulse' : '',
                  ].join(' ')}
                >
                  <span aria-hidden="true">{emoji}</span>
                </button>
              );
            })}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}
