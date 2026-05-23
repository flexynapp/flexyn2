// src/components/wellness/CycleTrackerCard.jsx
//
// Cycle tracker for the Progress page. Strictly opt-in — when the
// profile flag is off, the card renders an explanatory enable
// prompt with the "what does this do?" copy AND a clear privacy
// note ("only you can see this"). After enabling, the user can
// log their period start; the card then shows the current phase
// + a training-hint pill on subsequent renders.
//
// Phase computation is pure (`cyclePhase.js`), so this component
// is safe under SSR / pre-hydration mounts.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Heart, Plus, Loader2, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import * as cycleLogs from '@/lib/data/cycleLogs';
import { computeCycleState } from '@/lib/cyclePhase';
import { format } from 'date-fns';

function EnableCard({ onEnable }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-2xl border border-border bg-card p-4"
    >
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-rose-500/10 flex items-center justify-center shrink-0">
          <Heart className="w-5 h-5 text-rose-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-heading font-bold text-sm">Cycle tracking</h3>
          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
            Log your cycle to get training suggestions adapted to your
            current phase — strength bias in the follicular phase,
            higher volume tolerance in the luteal phase, lighter work
            during your period.
          </p>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] text-emerald-500 font-medium">
            <ShieldCheck className="w-3 h-3" />
            Private — only you can see this data.
          </div>
          <button
            type="button"
            onClick={onEnable}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-rose-500 text-white text-xs font-bold hover:bg-rose-600 transition-colors"
          >
            Enable cycle tracking
          </button>
        </div>
      </div>
    </motion.div>
  );
}

function LogStartModal({ open, onClose, onSubmit, submitting }) {
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [notes, setNotes] = useState('');
  if (!open) return null;
  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      onClick={onClose}
      className="fixed inset-0 z-[9999] bg-black/60 flex items-end sm:items-center justify-center p-4"
    >
      <motion.div
        initial={{ y: 24 }} animate={{ y: 0 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-sm bg-card border border-border rounded-2xl shadow-2xl p-4"
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-heading font-bold text-sm">Log period start</h3>
          <button onClick={onClose} className="w-7 h-7 rounded-full bg-secondary flex items-center justify-center">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Start date
            </label>
            <input
              type="date"
              value={date}
              max={format(new Date(), 'yyyy-MM-dd')}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
          <div>
            <label className="block text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">
              Notes (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value.slice(0, 200))}
              placeholder="cramps, mood, anything to remember"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => onSubmit({ startDate: date, notes })}
            disabled={submitting}
            className="w-full py-2.5 rounded-lg bg-rose-500 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            {submitting ? 'Saving…' : 'Save'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function CycleTrackerCard({ profile }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const enabled = !!profile?.cycle_tracking_enabled;
  const [logOpen, setLogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { data: logs = [] } = useQuery({
    queryKey: ['cycleLogs', user?.id],
    queryFn:  () => cycleLogs.listMine(user.id),
    enabled:  !!user?.id && enabled,
    staleTime: 5 * 60_000,
  });

  const state = enabled && logs.length > 0
    ? computeCycleState(
        logs.map(l => l.start_date),
        profile?.cycle_length_days,
      )
    : null;

  const handleEnable = async () => {
    const res = await cycleLogs.setEnabled(user.id, true);
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      toast.success('Cycle tracking enabled.');
    } else {
      toast.error('Could not enable. Try again.');
    }
  };

  const handleLog = async ({ startDate, notes }) => {
    setSubmitting(true);
    const res = await cycleLogs.logStart({ userId: user.id, startDate, notes });
    setSubmitting(false);
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ['cycleLogs', user?.id] });
      setLogOpen(false);
      toast.success('Period logged.');
    } else if (res.error === 'DUPLICATE') {
      toast.error('Already logged for that date.');
    } else {
      toast.error('Could not save. Try again.');
    }
  };

  if (!enabled) return <EnableCard onEnable={handleEnable} />;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="rounded-2xl border border-border bg-card p-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-rose-500/10 flex items-center justify-center">
              <Heart className="w-4 h-4 text-rose-500" />
            </div>
            <div>
              <h3 className="font-heading font-bold text-sm">Cycle</h3>
              {state ? (
                <p className="text-[11px] text-muted-foreground">
                  Day <span className="font-bold tabular-nums">{state.dayOfCycle}</span>
                  {' · '}
                  {state.daysUntilNext} day{state.daysUntilNext === 1 ? '' : 's'} until next
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">Log your first period start to begin.</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setLogOpen(true)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary text-xs font-bold transition-colors"
          >
            <Plus className="w-3 h-3" /> Log
          </button>
        </div>

        {state && (
          <div className="mt-3">
            <div
              className="rounded-xl p-3 border"
              style={{
                background: `${state.phaseMeta.color}15`,
                borderColor: `${state.phaseMeta.color}50`,
              }}
            >
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl leading-none" aria-hidden="true">{state.phaseMeta.emoji}</span>
                <p className="font-heading font-bold text-sm" style={{ color: state.phaseMeta.color }}>
                  {state.phaseMeta.label} phase
                </p>
              </div>
              <p className="text-[11px] text-foreground/85 leading-snug">
                {state.hint}
              </p>
            </div>
          </div>
        )}
      </motion.div>

      <LogStartModal
        open={logOpen}
        onClose={() => setLogOpen(false)}
        onSubmit={handleLog}
        submitting={submitting}
      />
    </>
  );
}
