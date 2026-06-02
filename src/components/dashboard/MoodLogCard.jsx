// src/components/dashboard/MoodLogCard.jsx
//
// One-tap daily mood logger. Five emoji buttons (😩 😐 🙂 😄 🔥),
// per-day upsert via mood_logs (migration 096). After logging, the
// card shrinks to a "logged" pill showing today's choice — gives the
// user closure without occupying full real estate after the action.

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { upsertMoodLog, getTodayMoodLog, MOOD_EMOJIS, MOOD_LABELS } from '@/lib/data/moodLogs';
import { tagMood } from '@/lib/data/journal';

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

  // Include today's local date in the query key so a PWA left open
  // across midnight doesn't keep showing yesterday's mood as already
  // logged. getTodayMoodLog itself derives "today" server-side, so the
  // cache key just needs to invalidate at the day boundary on the
  // client. Memoize so the IIFE doesn't burn a new string identity on
  // every render — the deps array `[]` is fine because midnight
  // rollover would require an external re-render anyway (the staleTime
  // refetch will catch it then).
  const todayDateKey = useMemo(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);
  const { data: today } = useQuery({
    queryKey: ['moodLogToday', user?.id, todayDateKey],
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
        // Auto-tag today's journal entry with the mood score so the
        // journal widget (and history log) surface the emoji for that day.
        // Fire-and-forget — journal tagging failure is non-fatal.
        const todayStr = (() => {
          const d = new Date();
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        })();
        tagMood(user.id, user.email, mood, todayStr).catch(() => {});
        qc.invalidateQueries({ queryKey: ['journalEntry', user?.id] });
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
      <Card className="px-3 py-2 h-full flex flex-col justify-center gap-1.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
          {(() => {
            if (!current) return tFallback('mood.prompt', 'How are you feeling?');
            const safe = Math.max(1, Math.min(5, Math.round(current)));
            return tFallback(`mood.label.${safe}`, MOOD_LABELS[safe - 1] || 'Logged');
          })()}
        </p>
        <div
          className="flex items-center justify-between gap-0.5"
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
                aria-label={tFallback(`mood.label.${mood}`, MOOD_LABELS[i] || `Mood ${mood}`)}
                className={[
                  'flex-1 aspect-square max-w-8 rounded-full text-base transition-transform flex items-center justify-center',
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
      </Card>
    </motion.div>
  );
}
