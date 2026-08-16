// src/components/crews/CrewChallengeCard.jsx
//
// Compact crew-challenge display + admin-only "New challenge" button.
// Rendered above the crew chat list. Members see active challenges +
// live progress bar; admins additionally see a "+ New" button to post
// a new one. Backed by mig 098's crew_challenges table.

import React, { useState, useRef, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Target, Plus, Loader2, ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import {
  listChallengesForCrew,
  createChallenge,
  syncMyCrewChallengeProgress,
  getChallengeContributions,
  VALID_METRICS,
} from '@/lib/data/crewChallenges';
import { formatDistanceToNow } from 'date-fns';

const METRIC_LABELS = {
  total_volume:   'Total volume (lb)',
  total_sessions: 'Total sessions',
  total_xp:       'Total XP',
  days_active:    'Days active',
};

function NewChallengeModal({ open, onClose, crewId, onCreated }) {
  const { tFallback } = useLanguage();
  const [title, setTitle] = useState('');
  const [metric, setMetric] = useState('total_volume');
  const [targetValue, setTargetValue] = useState('');
  const [days, setDays] = useState(7);
  const [submitting, setSubmitting] = useState(false);
  // Synchronous double-tap guard. `submitting` state lags React —
  // double-tap creates two challenges + double-pushes every crew
  // member via notify_crew_challenge_created_for. Wave 57 (Crews
  // audit) caught this.
  const submitRef = useRef(false);

  const handleSubmit = async () => {
    if (submitting || submitRef.current) return;
    submitRef.current = true;
    const target = parseFloat(targetValue);
    if (!title.trim()) {
      toast.error(tFallback('challenge.needTitle', 'Add a title.'));
      return;
    }
    if (!Number.isFinite(target) || target <= 0) {
      toast.error(tFallback('challenge.invalidTarget', 'Target must be > 0.'));
      return;
    }
    setSubmitting(true);
    const res = await createChallenge({
      crewId,
      title,
      metric,
      targetValue: target,
      endsAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
    });
    setSubmitting(false);
    submitRef.current = false;
    if (res.ok) {
      toast.success(tFallback('challenge.created', 'Challenge posted to your crew.'));
      onCreated?.();
      onClose?.();
    } else if (res.reason === 'not_admin') {
      toast.error(tFallback('challenge.notAdmin', "Only crew admins can post challenges."));
    } else {
      toast.error(tFallback('challenge.failed', 'Could not post — try again.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="max-w-md p-0 gap-0">
        <div className="p-5">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-4 h-4 text-primary" />
              {tFallback('challenge.newTitle', 'New crew challenge')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-boldr text-muted-foreground mb-1.5">
                {tFallback('challenge.title', 'Title')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder={tFallback("crewChallengeCard.crush100kLbTogether", "Crush 100k lb together")}
                maxLength={80}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-xs font-boldr text-muted-foreground mb-1.5">
                {tFallback('challenge.metric', 'Metric')}
              </label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {VALID_METRICS.map(m => (
                  <option key={m} value={m}>{METRIC_LABELS[m]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-boldr text-muted-foreground mb-1.5">
                {tFallback('challenge.target', 'Target')}
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder="100000"
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div>
              <label className="block text-xs font-boldr text-muted-foreground mb-1.5">
                {tFallback('challenge.duration', 'Duration (days)')}
              </label>
              <select
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {[3, 7, 14, 30].map(d => (
                  <option key={d} value={d}>{d} days</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex gap-2 mt-5">
            <Button variant="outline" onClick={onClose} className="flex-1">
              {tFallback('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1 gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {tFallback('challenge.post', 'Post challenge')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Per-member contribution breakdown. Collapsed by default — the point of
// the card is the crew bar, and on a phone a 16-row list would bury it.
function ContributionList({ challengeId, metric, open }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['crewChallengeContrib', challengeId],
    queryFn:  () => getChallengeContributions(challengeId),
    enabled:  !!challengeId && open,
    staleTime: 60_000,
  });

  if (!open) return null;

  if (isLoading) {
    return (
      <div className="pt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        {tFallback('challenge.loadingContrib', 'Loading contributions…')}
      </div>
    );
  }

  const scoring = rows.filter(r => (r.value || 0) > 0);

  if (scoring.length === 0) {
    return (
      <p className="pt-2 text-xs text-muted-foreground italic">
        {tFallback('challenge.noContrib', 'Nobody has logged toward this yet.')}
      </p>
    );
  }

  return (
    <ul className="pt-2 space-y-1">
      {scoring.map((r, i) => (
        <li key={r.user_id} className="flex items-center gap-2 text-xs">
          <span className="w-4 shrink-0 text-muted-foreground tabular-nums">{i + 1}</span>
          <span className="truncate flex-1">
            {r.username || r.full_name || tFallback('challenge.member', 'Member')}
          </span>
          <span className="shrink-0 tabular-nums font-semibold">
            {fmt(r.value || 0)}
            {metric === 'total_volume' ? ' lb' : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function CrewChallengeCard({ crewId, isAdmin }) {
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const qc = useQueryClient();
  const [composeOpen, setComposeOpen] = useState(false);
  const [expandedId, setExpandedId] = useState(null);

  const { data: challenges = [] } = useQuery({
    queryKey: ['crewChallenges', crewId],
    queryFn: () => listChallengesForCrew(crewId),
    enabled: !!crewId,
    staleTime: 60_000,
  });

  // Recompute my own contribution when the crew view opens, so a member
  // who trained on another device still sees the bar move without having
  // to save a workout first. The RPC only ever touches the caller's own
  // ledger row and derives the number server-side, so calling it on mount
  // is not a write the user can steer. Fire-and-forget: a failure leaves
  // the previous, already-correct aggregate on screen.
  const syncedRef = useRef(null);
  useEffect(() => {
    if (!crewId || syncedRef.current === crewId) return;
    syncedRef.current = crewId;
    let cancelled = false;
    syncMyCrewChallengeProgress()
      .then((res) => {
        if (cancelled || !res?.ok) return;
        qc.invalidateQueries({ queryKey: ['crewChallenges', crewId] });
        qc.invalidateQueries({ queryKey: ['crewChallengeContrib'] });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [crewId, qc]);

  if (!crewId) return null;

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-3"
      >
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-1.5">
            <Target className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
            <span className="text-xs font-bold text-primary">
              {tFallback('challenge.kicker', 'Crew challenges')}
            </span>
          </div>
          {isAdmin && (
            <button
              onClick={() => setComposeOpen(true)}
              className="inline-flex items-center gap-1 text-xs font-bold text-primary hover:text-primary/80 active:text-primary/80 transition-colors"
            >
              <Plus className="w-3 h-3" />
              {tFallback('challenge.new', 'New')}
            </button>
          )}
        </div>
        {challenges.length === 0 ? (
          <div className="text-xs text-muted-foreground italic px-1">
            {isAdmin
              ? tFallback('challenge.emptyAdmin', 'No active challenges. Post one to rally the crew.')
              : tFallback('challenge.empty', 'No active challenges yet.')}
          </div>
        ) : (
          <div className="space-y-2">
            {challenges.map(c => {
              const pct = Math.max(0, Math.min(1, (c.current_value || 0) / Math.max(c.target_value, 1)));
              // A generational challenge (migration 367) has no deadline,
              // and ends_at is NULL. `new Date(null)` is the epoch, so an
              // unguarded call renders "ends 56 years ago" on a goal that
              // has barely started.
              const remaining = c.ends_at
                ? formatDistanceToNow(new Date(c.ends_at), { addSuffix: true })
                : null;
              const open = expandedId === c.id;
              return (
                <div key={c.id} className="rounded-lg bg-card px-3 py-2">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-xs font-semibold truncate">{c.title}</p>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {remaining
                        ? tFallback('challenge.endsIn', 'ends {when}', { when: remaining })
                        : tFallback('challenge.noDeadline', 'no deadline')}
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full bg-secondary overflow-hidden mb-1">
                    <motion.div
                      className="h-full bg-primary"
                      initial={{ width: 0 }}
                      animate={{ width: `${pct * 100}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : c.id)}
                    aria-expanded={open}
                    className="w-full flex items-center justify-between text-xs text-muted-foreground tabular-nums"
                  >
                    <span className="text-start">
                      {fmt(c.current_value || 0)} / {fmt(c.target_value)} {METRIC_LABELS[c.metric]?.toLowerCase()}
                    </span>
                    <span className="flex items-center gap-1 shrink-0">
                      {Math.round(pct * 100)}%
                      <ChevronDown
                        className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`}
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                  <AnimatePresence initial={false}>
                    {open && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        className="overflow-hidden"
                      >
                        <ContributionList challengeId={c.id} metric={c.metric} open={open} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })}
          </div>
        )}
      </motion.div>

      {composeOpen && (
        <NewChallengeModal
          open={composeOpen}
          onClose={() => setComposeOpen(false)}
          crewId={crewId}
          onCreated={() => qc.invalidateQueries({ queryKey: ['crewChallenges', crewId] })}
        />
      )}
    </>
  );
}
