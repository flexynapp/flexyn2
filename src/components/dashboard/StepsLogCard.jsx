// src/components/dashboard/StepsLogCard.jsx
//
// Manual daily step logger for the Dashboard recovery row. Mirrors
// MoodLogCard's shape: per-day upsert via step_logs (migration 162),
// today's value displayed once logged with tap-to-edit. Numeric quick
// entry (no wearable sync — that's the separate native-app effort).

import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from '@/lib/toast';
import { Footprints, Check } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import { upsertStepLog, getTodayStepLog } from '@/lib/data/stepLogs';
import * as quests from '@/lib/data/quests';
import { ACTION_TYPES } from '@/lib/questCatalog';

const prefersReducedMotion = () => {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
};

function RollingCount({ value, format }) {
  const [display, setDisplay] = useState(0);
  const rafRef = useRef(null);
  const prevRef = useRef(0);

  useEffect(() => {
    const to = Number(value) || 0;
    if (prefersReducedMotion()) { setDisplay(to); prevRef.current = to; return undefined; }
    const from = prevRef.current;
    if (from === to) { setDisplay(to); return undefined; }
    const duration = 1400;
    const start = performance.now();
    const ease = (t) => 1 - Math.pow(1 - t, 3);
    const tick = (now) => {
      const elapsed = Math.min(duration, now - start);
      const t = ease(elapsed / duration);
      setDisplay(from + (to - from) * t);
      if (elapsed < duration) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(to);
        prevRef.current = to;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [value]);

  return <>{format(Math.round(display))}</>;
}

export default function StepsLogCard() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const qc = useQueryClient();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Day-boundary cache key so a PWA left open across midnight rolls
  // forward (same pattern as MoodLogCard's state + minute tick). The
  // bare IIFE pinned at mount left yesterday's count visible until a
  // manual refresh.
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
    queryKey: ['stepLogToday', user?.id, todayDateKey],
    queryFn: getTodayStepLog,
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
  });

  const logged = today?.steps ?? null;

  const save = async (val) => {
    const n = Math.round(Number(val));
    if (!Number.isFinite(n) || n < 0) {
      toast.error(tFallback('steps.invalid', 'Enter a number of steps.'));
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const res = await upsertStepLog({ steps: n });
      if (res.ok) {
        setDraft('');
        qc.invalidateQueries({ queryKey: ['stepLogToday', user?.id] });
        // Quest progress — the DELTA, not the new total. This row is an
        // upsert, so correcting 3,000 to 5,000 is one more save; crediting
        // the absolute figure each time would count those 3,000 steps twice
        // and walk a 5k quest to done off a 3k correction. Clamped at zero
        // so revising a count DOWN doesn't try to subtract (recordActions
        // drops non-positive amounts, but being explicit is cheaper than
        // relying on that).
        const delta = Math.max(0, n - (today?.steps ?? 0));
        if (delta > 0) {
          quests.recordAction(user, ACTION_TYPES.STEPS_LOGGED, delta)
            .then(() => qc.invalidateQueries({ queryKey: ['dailyQuests'] }))
            .catch(() => {});
        }
      } else {
        toast.error(tFallback('steps.saveFailed', 'Could not save steps — try again.'));
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (!user?.id) return null;

  const showCount = logged != null && draft === '';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="h-full"
    >
      <Card className="px-4 py-3 h-full flex flex-col justify-center gap-1.5">
        <div className="flex items-center gap-1.5">
          <Footprints className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
          <p className="text-micro font-bold tracking-[0.04em] text-muted-foreground">
            {tFallback('steps.kicker', 'Steps today')}
          </p>
        </div>

        {showCount ? (
          <button
            type="button"
            onClick={() => setDraft(String(logged))}
            className="text-start"
            aria-label={tFallback('steps.edit', 'Edit step count')}
          >
            <span className="text-xl font-heading font-bold leading-none tabular-nums">
              <RollingCount value={logged} format={fmt} />
            </span>
            <span className="text-micro text-muted-foreground ms-1.5">{tFallback('steps.tapEdit', 'tap to edit')}</span>
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            <input
              type="text"
              inputMode="numeric"
              autoFocus={draft !== ''}
              value={draft}
              onChange={e => setDraft(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
              onKeyDown={e => { if (e.key === 'Enter' && draft) save(draft); }}
              // Commit on blur too. The check button and Enter were the ONLY
              // ways to commit, and this card lives inside the Readiness sheet
              // under a full-width primary button — so typing a count and
              // reaching for the most save-looking control on the screen threw
              // the number away. `save` is re-entrancy guarded (savingRef), so
              // blur-then-click cannot double-write.
              onBlur={() => { if (draft) save(draft); }}
              placeholder={logged != null ? fmt(logged) : tFallback('steps.placeholder', 'e.g. 8000')}
              aria-label={tFallback('steps.aria', 'Enter your step count')}
              className="flex-1 min-w-0 h-8 rounded-sm border border-border bg-secondary/50 px-2 text-sm font-mono text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50"
            />
            <button
              type="button"
              onClick={() => draft && save(draft)}
              disabled={!draft || saving}
              aria-label={tFallback('steps.save', 'Save steps')}
              className="h-8 w-8 shrink-0 rounded-sm bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
            </button>
          </div>
        )}
      </Card>
    </motion.div>
  );
}
