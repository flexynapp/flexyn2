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
import { Sparkles, Camera, Dumbbell, Bell, Package, X, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { filterAfterReset } from '@/lib/accountReset';
import { usePushSubscription } from '@/lib/usePushSubscription';
import { reportError } from '@/lib/reportError';
import { requestOpenBag } from '@/lib/inventoryFlow';
import * as capsulesData from '@/lib/data/capsules';
import { isDailyChestReady } from '@/lib/dailyChest';
import {
  isDismissed,
  dismiss as dismissCard,
  DISCOVERY_CARDS,
  COOLDOWN_30_DAYS,
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
  accent,             // 'orange' | 'violet' | 'amber' | 'sky' | 'purple'
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
    sky: {
      ring:   'ring-1 ring-sky-500/20',
      bg:     'bg-gradient-to-br from-sky-500/10 via-card to-card',
      icon:   'bg-sky-500/15 text-sky-500',
      btn:    'bg-sky-500 hover:bg-sky-500/90 text-white',
    },
    // Purple — used for the OPEN_CAPSULE card. Matches the
    // capsule/loot visual language used elsewhere in UserBag
    // (purple-400 accents on the capsule cards) so the
    // discovery-card → bag handoff feels visually continuous.
    purple: {
      ring:   'ring-1 ring-purple-500/25',
      bg:     'bg-gradient-to-br from-purple-500/15 via-fuchsia-500/5 to-card',
      icon:   'bg-purple-500/15 text-purple-400',
      btn:    'bg-purple-500 hover:bg-purple-500/90 text-white',
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
              <ArrowRight className="w-4 h-4 stroke-[2.5] rtl:scale-x-[-1]" />
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
  const { t, tFallback } = useLanguage();
  const { user } = useAuth();
  const navigate = useNavigate();

  // Push subscription state — drives the PUSH_OPTIN pre-prompt card.
  // We only surface the card when push is supported AND not yet
  // subscribed AND permission hasn't been denied (a 'denied' state can
  // only be reversed via browser settings, so showing the card would
  // produce a broken CTA).
  const push = usePushSubscription();

  // Local re-render trigger after dismissal — discoveryPrefs writes to
  // localStorage which doesn't fire a React update. Bumping this forces
  // the useMemo below to re-evaluate `isDismissed`.
  const [dismissTick, setDismissTick] = useState(0);

  // Session-only dismissal — the openCapsule card has no localStorage
  // dismissal (an unopened capsule is unfinished onboarding, not banner
  // spam; we re-show on the next dashboard visit). But within a single
  // session the X button needs to actually hide the card. Without this
  // state, tapping X just re-renders and pickCard returns 'openCapsule'
  // again because unopenedCount > 0.
  const [sessionDismissed, setSessionDismissed] = useState(() => new Set());
  const dismissForSession = (cardKey) => setSessionDismissed(prev => {
    const next = new Set(prev);
    next.add(cardKey);
    return next;
  });

  // Unopened-capsule count drives the OPEN_CAPSULE card. Shares the
  // same query key Layout/ProfileMenu use so React Query dedupes —
  // single fetch lights up the badge AND the discovery card.
  const { data: unopenedCapsuleCount = 0 } = useQuery({
    queryKey: ['userCapsulesCount', user?.email],
    queryFn: async () => {
      const list = await capsulesData.listUnopenedCapsules(user.email);
      return list.length;
    },
    enabled: !!user?.email,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

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

    // 0. Open your first capsule — TOP priority for any user who has
    //    unopened capsules in their bag, EXCEPT when the daily chest is
    //    still claimable today. Chest takes priority over capsule so
    //    only ONE "tap me" prompt is on screen at a time — the user
    //    claims the chest, the capsule count goes up by one, then on
    //    the next render this card shows. Once claimed (or no chest
    //    today), the capsule banner takes over. After the user opens
    //    every capsule, neither card shows.
    if (unopenedCapsuleCount > 0 && !isDailyChestReady(user.id) && !sessionDismissed.has('openCapsule')) {
      return 'openCapsule';
    }

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

    // 3. AI Coach — last priority among "introduce a feature" cards.
    //    If the user has chat history on this device, the intro is
    //    redundant.
    if (workoutCount >= 1 && !hasCoachHistory(user.id) && !isDismissed(DISCOVERY_CARDS.AI_COACH)) {
      return 'coach';
    }

    // 4. Push opt-in pre-prompt — lowest priority. Only for engaged
    //    users (≥2 workouts) who haven't subscribed AND haven't
    //    explicitly denied permission at the browser level (denied
    //    can't be reversed without browser settings, so the CTA would
    //    be broken). The 30-day cooldown lets the prompt return for
    //    users who weren't ready the first time.
    if (
      push.isSupported &&
      !push.isSubscribed &&
      push.permission === 'default' &&
      workoutCount >= 2 &&
      !isDismissed(DISCOVERY_CARDS.PUSH_OPTIN, COOLDOWN_30_DAYS)
    ) {
      return 'pushOptIn';
    }

    return null;

  }, [
    isLoading, user,
    filteredLogs.length, filteredRegimens.length,
    push.isSupported, push.isSubscribed, push.permission,
    unopenedCapsuleCount,
    dismissTick,
    sessionDismissed,
  ]);

  const handleDismiss = useCallback((cardId) => {
    dismissCard(cardId);
    setDismissTick(n => n + 1);
  }, []);

  if (!card) return null;

  return (
    <AnimatePresence mode="wait" initial={false}>
      {card === 'openCapsule' && (
        <DiscoveryCard
          key="openCapsule"
          icon={Package}
          accent="purple"
          kicker={tFallback('discovery.openCapsule.kicker', 'GIFT WAITING')}
          title={
            t('discovery.openCapsule.title') ||
            (unopenedCapsuleCount === 1
              ? 'Your first capsule is waiting'
              : `You have ${unopenedCapsuleCount} unopened capsules`)
          }
          body={
            t('discovery.openCapsule.body') ||
            "Capsules drop stickers, frames, titles, and Flex Coins. Trade duplicates with friends. Open yours to see what's inside."
          }
          ctaLabel={tFallback('discovery.openCapsule.cta', 'Open it now')}
          dismissAriaLabel={tFallback('discovery.openCapsule.dismissLabel', 'Later')}
          onCta={() => {
            // Don't persist a dismissal — the card auto-hides the
            // moment the capsule is opened (count drops to 0). The
            // user can always come back to this state if they earn
            // another capsule.
            requestOpenBag();
          }}
          // "Later" dismisses for THIS session only — sessionDismissed
          // is in-memory state that's lost on reload. Intentional: an
          // unopened capsule is unfinished onboarding, not banner spam.
          // We re-nudge on the next visit; the user gets a way out of
          // the current view without it being permanently silenced.
          onDismiss={() => dismissForSession('openCapsule')}
        />
      )}

      {card === 'starter' && (
        <DiscoveryCard
          key="starter"
          icon={Dumbbell}
          accent="orange"
          kicker={tFallback('discovery.starter.kicker', 'YOUR PLAN')}
          title={tFallback('discovery.starter.title', 'Your starter plan is ready')}
          body={
            tFallback('discovery.starter.body', 'We built a regimen from your onboarding answers. Open it in Workout to start your first session.')
          }
          ctaLabel={tFallback('discovery.starter.cta', 'Start your first workout')}
          dismissAriaLabel={tFallback('discovery.dismiss', 'Dismiss')}
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
          kicker={tFallback('discovery.formCoach.kicker', 'BETA')}
          title={tFallback('discovery.formCoach.title', 'Try Form Coach')}
          body={
            tFallback('discovery.formCoach.body', 'On-device AI checks your lift form from a quick photo. No video, no upload — runs right on your phone.')
          }
          ctaLabel={tFallback('discovery.formCoach.cta', 'Try Form Coach')}
          dismissAriaLabel={tFallback('discovery.dismiss', 'Dismiss')}
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
          kicker={tFallback('discovery.coach.kicker', 'YOUR COACH')}
          title={tFallback('discovery.coach.title', 'Meet your AI Coach')}
          body={
            tFallback('discovery.coach.body', 'Personal advice tuned to your actual workouts, weight, and goals. Ask anything — programming, plateaus, recovery.')
          }
          ctaLabel={tFallback('discovery.coach.cta', 'Open Coach')}
          dismissAriaLabel={tFallback('discovery.dismiss', 'Dismiss')}
          onCta={() => {
            handleDismiss(DISCOVERY_CARDS.AI_COACH);
            navigate('/coach');
          }}
          onDismiss={() => handleDismiss(DISCOVERY_CARDS.AI_COACH)}
        />
      )}

      {card === 'pushOptIn' && (
        <DiscoveryCard
          key="pushOptIn"
          icon={Bell}
          accent="sky"
          kicker={tFallback('discovery.pushOptIn.kicker', 'STAY ON TRACK')}
          title={tFallback('discovery.pushOptIn.title', 'Want a daily nudge?')}
          body={
            t('discovery.pushOptIn.body') ||
            "Quiet, optional reminders to keep your streak alive. Manage them anytime in Settings — we'll never spam you."
          }
          ctaLabel={tFallback('discovery.pushOptIn.cta', 'Enable reminders')}
          dismissAriaLabel={tFallback('discovery.pushOptIn.dismissLabel', 'Not now')}
          onCta={async () => {
            // AWAIT the subscribe before dismissing so we know what to
            // do based on the outcome:
            //   - ok       → dismiss permanently
            //   - default  → user dismissed the native prompt; KEEP the
            //                card visible so they can try again later
            //   - denied   → dismiss (we can't request again from a denied state)
            //   - other err → dismiss + log
            // Previously the card was dismissed BEFORE the await, so a
            // user who closed the native prompt by accident had no path
            // back to enable. (Audit 08 #4.)
            try {
              const res = await push.subscribe();
              if (res.ok) {
                handleDismiss(DISCOVERY_CARDS.PUSH_OPTIN);
                toast.success(
                  tFallback('discovery.pushOptIn.toastEnabled', 'Reminders enabled — change anytime in Settings.')
                );
              } else if (res.reason === 'denied') {
                handleDismiss(DISCOVERY_CARDS.PUSH_OPTIN);
                toast.error(
                  tFallback('discovery.pushOptIn.toastDenied', 'Notifications blocked at the browser level. Re-enable from your browser settings if you change your mind.')
                );
              } else if (res.reason === 'unsupported') {
                handleDismiss(DISCOVERY_CARDS.PUSH_OPTIN);
                toast.error(
                  t('discovery.pushOptIn.toastUnsupported') ||
                  "This device doesn't support push notifications yet."
                );
              }
              // 'default' / 'server_error' / no outcome — leave the
              // card visible so the user can retry.
            } catch (err) {
              reportError(err, { feature: 'dashboard.push-optin', userEmail: user?.email });
              // Don't dismiss on unknown error — let the user try again.
            }
          }}
          onDismiss={() => handleDismiss(DISCOVERY_CARDS.PUSH_OPTIN)}
        />
      )}
    </AnimatePresence>
  );
}
