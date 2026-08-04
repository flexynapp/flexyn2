// src/components/dashboard/StreakRescueCard.jsx
//
// "Keep your N-day streak alive — log 1 set?" prompt that appears
// at the top of Dashboard when the trigger conditions match (see
// streakRescue.js). One-tap CTA navigates to the workout screen so
// the user can save the streak with minimal friction.
//
// Duolingo lives off this exact pattern — streak loss is the #1
// retention killer in fitness apps, and a soft 9 PM nudge for users
// who genuinely forgot recovers many of them.

import { motion, AnimatePresence } from 'framer-motion';
import { Flame, X, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { triggerHaptic } from '@/lib/haptic';
import { shouldShowStreakRescue, markStreakRescueDismissedToday } from '@/lib/data/streakRescue';

export default function StreakRescueCard({ streakDays, lastWorkoutDate, lastMealDate }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);

  const eligible = shouldShowStreakRescue({
    streakDays,
    lastWorkoutDate,
    lastMealDate,
    userEmail: user?.email,
  });
  if (!eligible || dismissed) return null;

  const handleResume = () => {
    triggerHaptic('primary');
    // Pre-mark dismissed so a slow navigation doesn't show this
    // banner on the next Dashboard mount.
    markStreakRescueDismissedToday(user?.email);
    setDismissed(true);
    navigate('/workout');
  };

  const handleDismiss = (e) => {
    e.stopPropagation();
    markStreakRescueDismissedToday(user?.email);
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -10, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        onClick={handleResume}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          // Only the outer card itself — not a focused descendant
          // (the inner Skip button) — should treat Enter/Space as
          // Resume. Without this gate, Tab→inner X→Enter fires BOTH
          // handleDismiss (click from button activation) AND
          // handleResume (keydown bubbling to this handler).
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleResume(); }
        }}
        className="flex items-center gap-3 p-3 mb-3 rounded-lg border-2 border-primary/35 bg-primary/10 cursor-pointer hover:border-primary/55 transition-colors"
        aria-label={tFallback('streakRescue.aria', `Keep your ${streakDays}-day streak alive`).replace('{n}', String(streakDays))}
      >
        <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
          <Flame className="w-5 h-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-micro font-bold tracking-[0.04em] text-primary">
            {tFallback('streakRescue.kicker', `${streakDays}-day streak at risk`).replace('{n}', String(streakDays))}
          </p>
          <p className="text-sm font-heading font-bold truncate">
            {tFallback('streakRescue.headline', 'Keep it alive — log 1 set')}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-2 rounded-lg text-muted-foreground hover:bg-secondary transition-colors shrink-0"
          aria-label={tFallback('streakRescue.skipAria', 'Skip today')}
        >
          <X className="w-4 h-4" />
        </button>
        <ArrowRight className="w-4 h-4 text-primary shrink-0 rtl:scale-x-[-1]" aria-hidden="true" />
      </motion.div>
    </AnimatePresence>
  );
}
