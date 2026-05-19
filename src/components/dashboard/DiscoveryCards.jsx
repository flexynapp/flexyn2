// src/components/dashboard/DiscoveryCards.jsx
//
// Single discovery-card slot for the Dashboard hero area. Shows ONE card
// at a time, picked by priority based on the user's onboarding journey:
//
//   1. STARTER_PLAN  — brand-new user (zero workouts logged) but has a
//                      regimen waiting in Workout → Regimens (from the
//                      onboarding starter-regimen generator).
//   2. FORM_COACH    — user has logged ≥1 workout; introduces the
//                      pose-detection flagship that lives behind the
//                      Workout idle screen.
//   3. AI_COACH      — user has logged ≥1 workout AND has no Coach
//                      history yet; introduces /coach.
//
// Mutual exclusion is intentional. Stacking 3 cards on Dashboard creates
// banner-fatigue; promoting the next card AFTER the user dismisses the
// current one is the same total info with less noise.
//
// Dismissals persist via discoveryPrefs (localStorage). A card is also
// implicitly dismissed when its precondition flips (e.g. the starter-
// plan card auto-hides once the user logs their first workout — the
// condition becomes false, no explicit dismissal needed).
//
// Errors inside a card are caught by an outer ErrorBoundary from
// Dashboard so a bug here never kills the page.

import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Sparkles, Camera, Dumbbell, X, ArrowRight } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { filterAfterReset } from '@/lib/accountReset';
import {
  isDismissed,
  dismiss as dismissCard,
  DISCOVERY_CARDS,
} from '@/lib/discoveryPrefs';

// localStorage key the CoachChat uses to remember chat history.
// Mirrored from src/components/coach/CoachChat.jsx (`_historyKey`).
// Kept in sync so we don't re-show the Coach intro to a user who has
// already messaged the coach on this device.
function coachHistoryKey(userId) {
  return `fn-coach-history-${userId || 'anon'}`;
}

function hasCoachHistory(userId) {
  try {
    const raw = localStorage.getItem(coachHistoryKey(userId));
    if (!raw) return false;
    const arr = JSON.parse(raw);
    return Array.isArray(arr) && arr.length > 0;
  } catch {
    // Storage error → assume no history (we'd rather show the card to
    // someone who's seen the coach than miss showing it to someone
    // who hasn't).
    return false;
  }
}

/**
 * Visual shell for one discovery card. Three variants (starter / form /
 * coach) share this shape so they feel like a coordinated system rather
 * than three random banners.
 */
function DiscoveryCard({
  icon: Icon,
  accent,             // 'orange' | 'violet' | 'amber'
  kicker,
  title,
  body,
  ctaLabel,
  onCta,
  onDismiss,
  dismissAriaLabel,
}) {
  // Static gradient/border classes keyed by accent. Inline-style alternatives
  // would defeat Tailwind's JIT purging — using fixed class strings here.
  const accents = {
    orange: {
      ring:   'ring-1 ring-orange-500/20',
      bg:     'bg-gradient-to-br from-orange-500/10 via-card to-card',
      icon:   'bg-orange-500/15 text-orange-500',
      btn:    'bg-orange-500 hover:bg-orange-500/90 text-white',
    },
    violet: {
      ring:   'ring-1 ring-violet-500/20',
      bg:     'bg-gradient-to-br from-violet-500/10 via-card to-card',
      icon:   'bg-violet-500/15 text-violet-500',
      btn:    'bg-violet-500 hover:bg-violet-500/90 text-white',
    },
    amber: {
      ring:   'ring-1 ring-amber-500/20',
      bg:     'bg-gradient-to-br from-amber-500/10 via-card to-card',
      icon:   'bg-amber-500/15 text-amber-500',
      btn:    'bg-amber-500 hover:bg-amber-500/90 text-white',
    },
  };
  const a = accents[accent] || accents.orange;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8, pointerEvents: 'none' }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className={`relative overflow-hidden p-4 md:p-5 border-border/60 ${a.bg} ${a.ring}`}>
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${a.icon}`}>
            <Icon className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            {kicker && (
              <div className="font-mono text-[10px] font-semibold tracking-[0.14em] uppercase text-muted-foreground mb-1">
                {kicker}
              </div>
            )}
            <h3 className="font-heading font-bold text-base leading-snug text-foreground">
              {title}
            </h3>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              {body}
            </p>
            <button
              type="button"
              onClick={onCta}
              className={`mt-3 inline-flex items-center gap-1.5 h-9 px-3 rounded-lg text-sm font-semibold transition-opacity ${a.btn}`}
            >
              {ctaLabel}
              <ArrowRight className="w-4 h-4 stroke-[2.5]" />
            </button>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissAriaLabel}
            className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </Card>
    </motion.div>
  );
}

export default function DiscoveryCards({ logs = [], regimens = [], isLoading = false }) {
  const { t } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Local re-render trigger after dismissal — discoveryPrefs writes to
  // localStorage which doesn't fire a React update. Bumping this forces
  // the useMemo below to re-evaluate `isDismissed`.
  const [dismissTick, setDismissTick] = useState(0);

  // filterAfterReset ensures a user who reset their account doesn't see
  // pre-reset workout rows still in cache — matches Dashboard's own
  // hero-card streak logic so the discovery state stays consistent.
  const filteredLogs = useMemo(
    () => filterAfterReset(logs, user, 'created_date'),
    [logs, user]
  );
  const filteredRegimens = useMemo(
    () => filterAfterReset(regimens, user, 'created_date'),
    [regimens, user]
  );

  // Pick the highest-priority card whose precondition is satisfied AND
  // is not yet dismissed. Returning null short-circuits the render.
  const card = useMemo(() => {
    if (isLoading) return null;
    if (!user?.email) return null;

    const workoutCount = filteredLogs.length;
    const regimenCount = filteredRegimens.length;

    // 1. Starter plan — only for users who literally have zero logged
    //    workouts AND a regimen waiting. Auto-hides on first workout.
    if (workoutCount === 0 && regimenCount > 0 && !isDismissed(DISCOVERY_CARDS.STARTER_PLAN)) {
      return 'starter';
    }

    // 2. Form Coach — once they've actually trained at least once, the
    //    flagship pose-detection feature is most useful. Don't push it
    //    before they have lifts to check.
    if (workoutCount >= 1 && !isDismissed(DISCOVERY_CARDS.FORM_COACH)) {
      return 'formCoach';
    }

    // 3. AI Coach — last priority. If the user has chat history on
    //    this device, the intro is redundant.
    if (workoutCount >= 1 && !hasCoachHistory(user.id) && !isDismissed(DISCOVERY_CARDS.AI_COACH)) {
      return 'coach';
    }

    return null;

  }, [isLoading, user, filteredLogs.length, filteredRegimens.length, dismissTick]);

  const handleDismiss = useCallback((cardId) => {
    dismissCard(cardId);
    setDismissTick(n => n + 1);
  }, []);

  if (!card) return null;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {card === 'starter' && (
        <DiscoveryCard
          key="starter"
          icon={Dumbbell}
          accent="orange"
          kicker={t('discovery.starter.kicker') || 'YOUR PLAN'}
          title={t('discovery.starter.title') || 'Your starter plan is ready'}
          body={
            t('discovery.starter.body') ||
            'We built a regimen from your onboarding answers. Open it in Workout to start your first session.'
          }
          ctaLabel={t('discovery.starter.cta') || 'Start your first workout'}
          dismissAriaLabel={t('discovery.dismiss') || 'Dismiss'}
          onCta={() => {
            handleDismiss(DISCOVERY_CARDS.STARTER_PLAN);
            navigate('/workout', { state: { openRegimens: true } });
          }}
          onDismiss={() => handleDismiss(DISCOVERY_CARDS.STARTER_PLAN)}
        />
      )}

      {card === 'formCoach' && (
        <DiscoveryCard
          key="formCoach"
          icon={Camera}
          accent="violet"
          kicker={t('discovery.formCoach.kicker') || 'BETA'}
          title={t('discovery.formCoach.title') || 'Try Form Coach'}
          body={
            t('discovery.formCoach.body') ||
            'On-device AI checks your lift form from a quick photo. No video, no upload — runs right on your phone.'
          }
          ctaLabel={t('discovery.formCoach.cta') || 'Try Form Coach'}
          dismissAriaLabel={t('discovery.dismiss') || 'Dismiss'}
          onCta={() => {
            // Dismiss-on-launch: the user has now seen it; don't pester
            // them again. If they want it back they can find it on the
            // Workout idle screen permanently.
            handleDismiss(DISCOVERY_CARDS.FORM_COACH);
            // Fire-and-navigate: the event arrives on the new route's
            // listener (Workout.jsx). Dispatched BEFORE navigate so the
            // listener registered after Workout mounts will also pick
            // it up via the state.openFormCoach prop fallback below.
            navigate('/workout', { state: { openFormCoach: true } });
          }}
          onDismiss={() => handleDismiss(DISCOVERY_CARDS.FORM_COACH)}
        />
      )}

      {card === 'coach' && (
        <DiscoveryCard
          key="coach"
          icon={Sparkles}
          accent="amber"
          kicker={t('discovery.coach.kicker') || 'YOUR COACH'}
          title={t('discovery.coach.title') || 'Meet your AI Coach'}
          body={
            t('discovery.coach.body') ||
            'Personal advice tuned to your actual workouts, weight, and goals. Ask anything — programming, plateaus, recovery.'
          }
          ctaLabel={t('discovery.coach.cta') || 'Open Coach'}
          dismissAriaLabel={t('discovery.dismiss') || 'Dismiss'}
          onCta={() => {
            handleDismiss(DISCOVERY_CARDS.AI_COACH);
            navigate('/coach');
          }}
          onDismiss={() => handleDismiss(DISCOVERY_CARDS.AI_COACH)}
        />
      )}
    </AnimatePresence>
  );
}
