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
import { Heart, Plus, Loader2, X, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import * as cycleLogs from '@/lib/data/cycleLogs';
import { db } from '@/api/db';
import { computeCycleState } from '@/lib/cyclePhase';
import { format } from 'date-fns';

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
            <label className="block text-micro font-semibold uppercase tracking-wide text-muted-foreground mb-1">
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
            <label className="block text-micro font-semibold uppercase tracking-wide text-muted-foreground mb-1">
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
  // History disclosure + per-row delete. Deleting is two taps (tap the bin,
  // then confirm) rather than one — this is health data on a phone, and a
  // stray tap on a 28px target shouldn't silently drop a logged date.
  const [historyOpen, setHistoryOpen] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);

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

  const handleDisable = async () => {
    const res = await cycleLogs.setEnabled(user.id, false);
    if (res.ok) {
      // db.auth.me() serves a module-level cache and only re-reads the row
      // when that cache is empty, so the invalidation below refetches and is
      // handed the same stale object back. Without this the card stayed on
      // screen until a full reload and the X read as broken.
      db.auth.patchCache(res.patch);
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      toast.success('Cycle tracking removed. Re-enable it in Settings.');
    } else {
      toast.error('Could not update. Try again.');
    }
  };

  // cycleLogs.remove() has existed since migration 128 but nothing ever
  // called it, so a logged start date was permanent: the card only rendered
  // the computed phase, never the underlying entries. The ✕ in the header
  // looks like a way out but only flips cycle_tracking_enabled off — the row
  // survives, so re-enabling brought the same wrong date back. And logStart
  // rejects a duplicate start_date (23505), so you couldn't correct a typo by
  // re-logging either. This is the missing delete.
  const handleDelete = async (id) => {
    setDeletingId(id);
    const res = await cycleLogs.remove(id);
    setDeletingId(null);
    setPendingDeleteId(null);
    if (res.ok) {
      queryClient.invalidateQueries({ queryKey: ['cycleLogs', user?.id] });
    } else {
      toast.error('Could not remove that entry. Try again.');
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

  // Removed from the Body page when disabled — re-enable via Settings.
  if (!enabled) return null;

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
                <p className="text-micro text-muted-foreground">
                  Day <span className="font-bold tabular-nums">{state.dayOfCycle}</span>
                  {' · '}
                  {state.daysUntilNext} day{state.daysUntilNext === 1 ? '' : 's'} until next
                </p>
              ) : (
                <p className="text-micro text-muted-foreground">Log your first period start to begin.</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setLogOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-secondary/60 hover:bg-secondary active:bg-secondary text-xs font-bold transition-colors"
            >
              <Plus className="w-3 h-3" /> Log
            </button>
            <button
              type="button"
              onClick={handleDisable}
              aria-label="Remove cycle tracking"
              title="Remove cycle tracking"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-muted-foreground hover:text-destructive active:text-destructive hover:bg-destructive/10 active:bg-destructive/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
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
              <p className="text-micro text-foreground/85 leading-snug">
                {state.hint}
              </p>
            </div>
          </div>
        )}

        {/* Logged entries. Collapsed by default so the card stays a
            glanceable phase summary; expanding is what gives you the way to
            correct or remove a date you logged. */}
        {logs.length > 0 && (
          <div className="mt-3 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => { setHistoryOpen(v => !v); setPendingDeleteId(null); }}
              aria-expanded={historyOpen}
              className="w-full flex items-center justify-between py-1 text-micro font-bold uppercase tracking-wide text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
            >
              <span>Logged periods · {logs.length}</span>
              {historyOpen
                ? <ChevronUp className="w-3.5 h-3.5" />
                : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {historyOpen && (
              <ul className="mt-1 space-y-1">
                {[...logs].reverse().map((l) => {
                  // start_date is a bare YYYY-MM-DD. `new Date('2026-07-29')`
                  // parses as UTC midnight, which renders as the PREVIOUS day
                  // for anyone west of UTC — pin it to local midnight so the
                  // list shows the date the user actually picked.
                  const label = format(new Date(`${l.start_date}T00:00:00`), 'MMM d, yyyy');
                  const confirming = pendingDeleteId === l.id;
                  const busy = deletingId === l.id;
                  return (
                    <li
                      key={l.id}
                      className="flex items-center justify-between gap-2 rounded-lg bg-secondary/40 px-2.5 py-1.5"
                    >
                      <div className="min-w-0">
                        <p className="text-xs text-foreground truncate">{label}</p>
                        {l.notes && (
                          <p className="text-micro text-muted-foreground truncate">{l.notes}</p>
                        )}
                      </div>
                      {confirming ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleDelete(l.id)}
                            disabled={busy}
                            className="inline-flex items-center justify-center min-w-[52px] px-2 py-1 rounded text-micro font-bold uppercase tracking-wide bg-destructive text-destructive-foreground disabled:opacity-50"
                          >
                            {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Delete'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteId(null)}
                            disabled={busy}
                            className="px-2 py-1 rounded text-micro font-bold uppercase tracking-wide border border-border text-muted-foreground hover:bg-secondary active:bg-secondary disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(l.id)}
                          aria-label={`Remove period logged on ${label}`}
                          className="inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-lg text-muted-foreground hover:text-destructive active:text-destructive hover:bg-destructive/10 active:bg-destructive/10 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
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
