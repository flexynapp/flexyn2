// src/components/bounties/CreateBountyModal.jsx
//
// Compose a bounty on YOUR OWN record. "First to beat my 315 squat
// wins 100 coins." Server-side validates caller == target (mig 098)
// so no anti-griefing concerns here — but we still gate the UI to
// the user's own profile.

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Target } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/lib/LanguageContext';
import { createUserBounty } from '@/lib/data/bounties';

const METRIC_OPTIONS = [
  { id: 'single_lift_weight', label: 'Single-lift max weight', needsExercise: true,  hint: 'e.g. "Beat my 315 squat"' },
  { id: 'single_lift_reps',   label: 'Single-lift max reps',   needsExercise: true,  hint: 'e.g. "Beat my 20 pull-ups"' },
  { id: 'session_volume',     label: 'Session volume',         needsExercise: false, hint: 'Total lbs lifted in one workout' },
  { id: 'weekly_volume',      label: 'Weekly volume',          needsExercise: false, hint: 'Total lbs lifted in 7 days' },
];

const DIFFICULTY_OPTIONS = [
  { id: 'easy',   label: 'Easy',   reward: '60 coins',  cost: '10 coins' },
  { id: 'medium', label: 'Medium', reward: '100 coins', cost: '15 coins' },
  { id: 'hard',   label: 'Hard',   reward: '175 coins', cost: '20 coins' },
];

export default function CreateBountyModal({ open, onClose, onCreated }) {
  const { tFallback } = useLanguage();
  const [metric, setMetric] = useState('single_lift_weight');
  const [exerciseName, setExerciseName] = useState('');
  const [targetValue, setTargetValue] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [submitting, setSubmitting] = useState(false);

  const meta = METRIC_OPTIONS.find(m => m.id === metric);

  const reset = () => {
    setMetric('single_lift_weight');
    setExerciseName('');
    setTargetValue('');
    setDifficulty('medium');
    setSubmitting(false);
  };

  // Sync ref guard so a double-tap can't fire two createUserBounty
  // calls before `submitting` state propagates. Each call deducts
  // an entry fee from the user's Flex Coins, so a duplicate is
  // real lost coin spend — not just a UX annoyance.
  const submitRef = useRef(false);

  const handleSubmit = async () => {
    if (submitting || submitRef.current) return;
    const targetNum = parseFloat(targetValue);
    if (!Number.isFinite(targetNum) || targetNum <= 0) {
      toast.error(tFallback('createBounty.invalidTarget', 'Enter a positive target value.'));
      return;
    }
    if (meta.needsExercise && !exerciseName.trim()) {
      toast.error(tFallback('createBounty.needExercise', 'Enter the exercise name.'));
      return;
    }
    submitRef.current = true;
    setSubmitting(true);
    const res = await createUserBounty({
      metric,
      exerciseName: meta.needsExercise ? exerciseName.trim() : null,
      targetValue: targetNum,
      difficulty,
      // 48-hour default expiry — matches the auto-generated bounty
      // expiry window from DIFFICULTY_CONFIG in bounties.js.
      expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    });
    setSubmitting(false);
    submitRef.current = false;
    if (res.ok) {
      toast.success(tFallback('createBounty.posted', 'Bounty posted! Friends can now try to beat it.'));
      reset();
      onCreated?.(res.id);
      onClose?.();
    } else if (res.reason === 'rpc_missing') {
      toast.error(tFallback('createBounty.serverOutdated', 'Server needs an update — try again later.'));
    } else {
      toast.error(tFallback('createBounty.failed', 'Could not post bounty — try again.'));
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose?.()}>
      <DialogContent className="max-w-md p-0 gap-0">
        <div className="p-5">
          <DialogHeader className="mb-4">
            <DialogTitle className="flex items-center gap-2">
              <Target className="w-4 h-4 text-amber-500" />
              {tFallback('createBounty.title', 'Post a bounty on your record')}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {/* Metric */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                {tFallback('createBounty.metric', 'Metric')}
              </label>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {METRIC_OPTIONS.map(m => (
                  <option key={m.id} value={m.id}>{m.label}</option>
                ))}
              </select>
              <p className="text-[10px] text-muted-foreground mt-1">{meta.hint}</p>
            </div>

            {/* Exercise (conditional) */}
            <AnimatePresence>
              {meta.needsExercise && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                >
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                    {tFallback('createBounty.exercise', 'Exercise')}
                  </label>
                  <input
                    type="text"
                    value={exerciseName}
                    onChange={(e) => setExerciseName(e.target.value)}
                    placeholder="e.g. Squat"
                    maxLength={60}
                    className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Target value */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                {tFallback('createBounty.target', 'Target value to beat')}
              </label>
              <input
                type="number"
                inputMode="decimal"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder="315"
                className="w-full px-3 py-2 rounded-lg bg-secondary border border-border text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>

            {/* Difficulty */}
            <div>
              <label className="block text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-1.5">
                {tFallback('createBounty.difficulty', 'Difficulty (sets reward)')}
              </label>
              <div className="grid grid-cols-3 gap-2">
                {DIFFICULTY_OPTIONS.map(d => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => setDifficulty(d.id)}
                    aria-pressed={difficulty === d.id}
                    className={[
                      'px-2 py-2.5 rounded-lg border text-center transition-colors',
                      difficulty === d.id
                        ? 'border-primary bg-primary/10'
                        : 'border-border bg-secondary/40 hover:bg-secondary',
                    ].join(' ')}
                  >
                    <p className="text-xs font-bold">{d.label}</p>
                    <p className="text-[10px] text-amber-500 mt-0.5">{d.reward}</p>
                    <p className="text-[10px] text-muted-foreground">cost {d.cost}</p>
                  </button>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground leading-snug">
              {tFallback(
                'createBounty.disclaimer',
                "When someone beats your target, they claim the reward and you lose the entry fee. Expires in 48h.",
              )}
            </p>
          </div>

          <div className="flex gap-2 mt-5">
            <Button variant="outline" onClick={() => { reset(); onClose?.(); }} className="flex-1">
              {tFallback('common.cancel', 'Cancel')}
            </Button>
            <Button onClick={handleSubmit} disabled={submitting} className="flex-1 gap-2">
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {tFallback('createBounty.post', 'Post bounty')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
