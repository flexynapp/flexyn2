// src/components/hub/ProfileCompletionMeter.jsx
//
// Small horizontal progress meter on your OWN Hub profile that nudges
// you to complete the identity surface. LinkedIn / Strava / Duolingo
// all do this — investment in your own profile correlates strongly
// with retention. We don't gamify with hard rewards (XP / capsules)
// because that creates incentive to spam; just a visual completeness
// signal that quietly suggests the next polish step.
//
// Each "task" is a boolean. The first uncompleted one becomes the
// "next step" hint shown below the bar. When all are complete, the
// meter still renders briefly with a "100% — looking sharp" pill,
// but a dismiss button + localStorage flag hides it forever after
// the user acknowledges.

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { CheckCircle2, ArrowRight, X } from 'lucide-react';
import { useLanguage } from '@/lib/LanguageContext';

const LS_KEY = (userId) => `flexyn.profileCompletionDismissed.${userId || 'anon'}`;

function buildTasks(user, targetProfile, tFallback) {
  // Profile data on `user` (auth) supplements targetProfile, but on
  // self-view both have the same fields. Read from either.
  const p = targetProfile || {};
  const u = user || {};
  const has = (v) => typeof v === 'string' ? v.trim().length > 0 : !!v;
  const hasArr = (v) => Array.isArray(v) && v.length > 0;
  // Pulled through tFallback so non-English users see localized labels.
  // Previously every step in the completion meter rendered in English
  // regardless of the user's app language.
  return [
    { id: 'avatar',   label: tFallback('profile.completion.avatar',   'Add a profile photo'),    done: has(u.avatar_url || p.avatar_url) },
    { id: 'username', label: tFallback('profile.completion.username', 'Pick a username'),        done: has(u.username || p.username) },
    { id: 'bio',      label: tFallback('profile.completion.bio',      'Write a short bio'),      done: has(u.bio || p.bio) },
    { id: 'city',     label: tFallback('profile.completion.city',     'Add your city'),          done: has(u.city || p.city) },
    { id: 'goal',     label: tFallback('profile.completion.goal',     'Choose a fitness goal'),  done: hasArr(u.fitness_goals_arr) || has(u.fitness_goals) },
    { id: 'workout',  label: tFallback('profile.completion.workout',  'Log your first workout'), done: (Number(u.total_xp) || 0) > 0 },
  ];
}

export default function ProfileCompletionMeter({ user, targetProfile }) {
  const { tFallback } = useLanguage();
  const userId = user?.id;
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem(LS_KEY(userId)) === '1'; }
    catch { return false; }
  });

  const tasks = useMemo(
    () => buildTasks(user, targetProfile, tFallback),
    [user, targetProfile, tFallback],
  );

  const done = tasks.filter(t => t.done).length;
  const total = tasks.length;
  const pct = Math.round((done / total) * 100);
  const nextStep = tasks.find(t => !t.done);

  const handleDismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(LS_KEY(userId), '1'); } catch { /* ignore */ }
  };

  // Hide entirely once dismissed. Also hide if the user has zero
  // tasks done — that's actually a brand-new account in the pre-
  // onboarding window where surfacing this would be redundant with
  // onboarding nudges.
  if (dismissed) return null;
  if (done === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      // No card. This is a progress read-out, not an object — the bar and
      // the label carry it, the way the XP rail does on the banner.
      className="mb-6"
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          <CheckCircle2 className="w-3 h-3 text-emerald-500" />
          {tFallback('profile.completion.title', 'Profile completion')}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold tabular-nums text-foreground">
            {pct}%
          </span>
          {pct === 100 && (
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss"
              className="w-5 h-5 rounded-full bg-secondary/60 hover:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <div className="h-1 w-full rounded-full bg-border overflow-hidden">
        <motion.div
          className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500"
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </div>
      {pct < 100 && nextStep && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <ArrowRight className="w-3 h-3 text-primary" />
          <span>{tFallback('profile.completion.nextLabel', 'Next:')} <span className="text-foreground font-medium">{nextStep.label}</span></span>
        </div>
      )}
      {pct === 100 && (
        <p className="mt-2 text-xs text-emerald-500 font-medium">
          {tFallback('profile.completion.allSet', 'Looking sharp — all set!')}
        </p>
      )}
    </motion.div>
  );
}
