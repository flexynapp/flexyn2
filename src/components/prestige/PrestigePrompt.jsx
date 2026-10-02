// src/components/prestige/PrestigePrompt.jsx
// Persistent card shown on Dashboard when user hits max level.
// Two-step confirmation before the irreversible prestige action.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, ChevronRight, X, AlertTriangle, Loader2, Sparkles } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  performPrestige,
  dismissPrestigePrompt,
  PRESTIGE_TITLE,
  PRESTIGE_ROMAN,
  prestigeCoins,
} from '@/lib/data/prestige';
import { toast } from '@/lib/toast';
import { reportError } from '@/lib/reportError';
import { useNumberFormatter } from '@/lib/intl';
import { useLanguage } from '@/lib/LanguageContext';

const RESETS   = ['Current XP', 'Display level', 'Current season rank'];
const PERSISTS = ['Lifetime XP total', 'All workout logs', 'All PRs & volume history', 'Flex Coins', 'Crew membership', 'Gym Rival history'];

export default function PrestigePrompt({ currentPrestige = 0, onDismiss }) {
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const fmt = useNumberFormatter();
  const [step, setStep] = useState('prompt'); // 'prompt' | 'confirm'

  const nextTier   = currentPrestige + 1;
  const title      = PRESTIGE_TITLE[nextTier] || '';
  const roman      = PRESTIGE_ROMAN[nextTier] || String(nextTier);
  const coins      = prestigeCoins(nextTier);

  const dismissMut = useMutation({
    mutationFn: dismissPrestigePrompt,
    onSuccess:  () => {
      qc.invalidateQueries({ queryKey: ['userProfile'] });
      onDismiss?.();
    },
    onError: (err) => {
      // Dismiss is intentionally low-stakes — log it but don't yell
      // at the user. They can dismiss the next time the prompt shows.
      reportError(err, { feature: 'prestige.dismiss', level: 'warning' });
    },
  });

  const prestigeMut = useMutation({
    mutationFn: performPrestige,
    onSuccess: (result) => {
      toast.success(tFallback('notice.prestigeReached', 'Prestige {roman} reached!', { roman }), {
        description: tFallback('notice.prestigeReward', '+{coins} Flex Coins · "{title}"', { coins: result.coins_awarded, title }),
        duration: 6000,
      });
      qc.invalidateQueries({ queryKey: ['userProfile'] });
    },
    onError: (err) => {
      toast.error(tFallback("prestigePrompt.prestigeFailed", "Prestige failed"), { description: err.message });
    },
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border-2 border-yellow-500/40 bg-yellow-500/5 overflow-hidden mb-4"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-yellow-500/20 flex items-center justify-center">
            <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
          </div>
          <span className="font-black text-sm">{tFallback("prestigePrompt.maxLevelReached", "Max Level Reached")}</span>
        </div>
        <button
          onClick={() => dismissMut.mutate()}
          className="p-1.5 rounded-full hover:bg-secondary active:bg-secondary transition-colors"
        >
          <X className="w-3.5 h-3.5 text-muted-foreground" />
        </button>
      </div>

      <AnimatePresence mode="wait">
        {step === 'prompt' && (
          <motion.div
            key="prompt"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="px-4 pb-4 space-y-3"
          >
            <p className="text-sm text-muted-foreground">
              You've conquered every level. Prestige and start again — earn a permanent badge and exclusive rewards.
            </p>

            {/* Reward preview */}
            <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 p-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-yellow-500/20 border-2 border-yellow-500 flex items-center justify-center shrink-0">
                <span className="text-xs font-black text-yellow-600">P·{roman}</span>
              </div>
              <div>
                <p className="text-sm font-bold">{title}</p>
                <p className="text-xs text-muted-foreground">+{fmt(coins)} Flex Coins · Permanent badge</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => dismissMut.mutate()}
                className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold hover:bg-secondary active:bg-secondary transition-colors"
              >
                {tFallback("prestigePrompt.notYet", "Not Yet")}
              </button>
              <button
                onClick={() => setStep('confirm')}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-yellow-500 text-slate-900 text-xs font-black hover:bg-yellow-400 active:bg-yellow-400 transition-colors"
              >
                {tFallback("prestigePrompt.prestigeNow", "Prestige Now")}
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </motion.div>
        )}

        {step === 'confirm' && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="px-4 pb-4 space-y-4"
          >
            <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-500/10 border border-rose-500/20">
              <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <p className="text-xs font-semibold text-rose-500">{tFallback('prestige.irreversible', 'This action is irreversible.')}</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="eyebrow text-rose-500 mb-1.5">{tFallback("prestigePrompt.resets", "Resets")}</p>
                <ul className="space-y-1">
                  {RESETS.map(r => (
                    <li key={r} className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-rose-500 shrink-0" />
                      {r}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="eyebrow text-emerald-500 mb-1.5">{tFallback("prestigePrompt.persists", "Persists")}</p>
                <ul className="space-y-1">
                  {PERSISTS.map(p => (
                    <li key={p} className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <span className="w-1 h-1 rounded-full bg-emerald-500 shrink-0" />
                      {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setStep('prompt')}
                className="flex-1 py-2 rounded-xl border border-border text-xs font-semibold hover:bg-secondary active:bg-secondary transition-colors"
              >
                {tFallback("prestigePrompt.goBack", "Go Back")}
              </button>
              <button
                onClick={() => prestigeMut.mutate()}
                disabled={prestigeMut.isPending}
                className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-yellow-500 text-slate-900 text-xs font-black hover:bg-yellow-400 active:bg-yellow-400 disabled:opacity-50 transition-colors"
              >
                {prestigeMut.isPending
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <><Sparkles className="w-3.5 h-3.5" /> {tFallback("prestigePrompt.confirmPrestige", "Confirm Prestige")}</>
                }
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
