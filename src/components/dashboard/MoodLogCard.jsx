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

  // Today's local date string drives the query key so a PWA left open
  // across midnight stops treating yesterday's mood as today's. The
  // previous `useMemo(..., [])` pinned the key at mount and the day
  // never rolled forward; this state + minute tick advances the key
  // on the first render after midnight.
  const computeTodayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const [todayDateKey, setTodayDateKey] = useState(computeTodayKey);
  useEffect(() => {
    const id = setInterval(() => {
      const next = computeTodayKey();
      setTodayDateKey(prev => (prev === next ? prev : next));
    }, 60_000);
    return () => clearInterval(id);
  }, []);
  const { data: today } = useQuery({
    queryKey: ['moodLogToday', user?.id, todayDateKey],
    queryFn: getTodayMoodLog,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  // Sync optimistic only when there's no in-flight submission, so a
  // mid-tap refetch arriving with the previous server value doesn't
  // clobber the user's just-chosen emoji and produce a flicker.
  useEffect(() => {
    if (submittingRef.current) return;
    if (today?.mood) setOptimistic(today.mood);
  }, [today?.mood]);

  // Pin the pre-tap value so a failed save reverts to the SAME value
  // we showed before optimism — `today?.mood` evaluated after the
  // await might have changed under us between user input and the
  // network response.
  const handleTap = async (mood) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(mood);
    const priorOptimistic = optimistic;
    const priorServerMood = today?.mood ?? null;
    setOptimistic(mood); // optimistic
    try {
      const res = await upsertMoodLog({ mood });
      if (!mountedRef.current) return; // bail if unmounted mid-request
      if (res.ok) {
        // Invalidate the 3-key form to match the query above. Prefix
        // matching meant the 2-key form ['moodLogToday', user?.id]
        // technically also worked, but the explicit shape removes the
        // ambiguity for the next reader and avoids accidentally
        // invalidating any sibling query that might key on
        // ['moodLogToday', user?.id, <other>] in the future.
        qc.invalidateQueries({ queryKey: ['moodLogToday', user?.id, todayDateKey] });
        // Auto-tag today's journal entry with the mood score so the
        // journal widget (and history log) surface the emoji for that day.
        // Fire-and-forget — journal tagging failure is non-fatal.
        tagMood(user.id, user.email, mood, todayDateKey).catch(() => {});
        qc.invalidateQueries({ queryKey: ['journalEntry', user?.id] });
      } else {
        // Revert to the value we showed before the tap, not whatever
        // `today` happens to hold after the await — those can diverge
        // when a refetch lands during the in-flight save.
        setOptimistic(priorOptimistic ?? priorServerMood);
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
            // `safe` is clamped 1-5 above, MOOD_LABELS has 5 entries,
            // so MOOD_LABELS[safe - 1] is always defined under normal
            // flow. The `|| 'Logged'` defensive fallback handles only
            // the corrupt-import case where MOOD_LABELS came back
            // empty / undefined.
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
                // min-w-[44px] min-h-[44px] hits the iOS HIG accessible
                // touch target. opacity-70 baseline reads on mobile
                // where there's no hover state (the prior opacity-60 +
                // hover-only opacity-100 left mobile users with a
                // permanently-faded row). animate-pulse honors the
                // motion-reduce media query so vestibular-sensitive
                // users don't get a 700ms cycle while the save's in
                // flight — they still see the disabled-button signal.
                className={[
                  'flex-1 aspect-square min-w-[44px] min-h-[44px] max-w-11 rounded-full text-base transition-transform flex items-center justify-center',
                  isActive
                    ? 'bg-primary/15 scale-110'
                    : 'opacity-70 hover:opacity-100 hover:scale-110',
                  isBusy ? 'animate-pulse motion-reduce:animate-none' : '',
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
