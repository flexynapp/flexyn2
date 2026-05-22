// src/components/dashboard/OnboardingNudgeCard.jsx
//
// Single "today's nudge" card on the Dashboard for new users. Walks
// the user through 5-7 activation steps over their first week:
//   1. Log your first workout
//   2. Enable notifications
//   3. Follow a friend
//   4. Try a regimen
//   5. Share your week
//   6. Invite a friend (referral)
//
// At any moment, AT MOST ONE nudge renders. The component picks the
// first uncompleted nudge whose prerequisite is satisfied, then
// suppresses re-shows for 24 hours after either a completion OR a
// dismiss. After all nudges are complete (or the user has been around
// long enough that none apply), the card hides forever.
//
// PER-USER LOCALSTORAGE SCHEMA
// ────────────────────────────
//   key: flexyn.onboardingState.<userId>
//   value: { completed: ['first_workout', ...], lastShownDate: 'YYYY-MM-DD' }
//
// Sticks to localStorage rather than the DB — onboarding is per-device
// experience-shaping, not durable preference, and a missed nudge on
// device B isn't catastrophic.

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Dumbbell, Bell, UserPlus, ClipboardList, Share2, Gift, X, ArrowRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { usePushSubscription } from '@/lib/usePushSubscription';
import { supabase } from '@/api/supabaseClient';

const STATE_KEY = (userId) => `flexyn.onboardingState.${userId || 'anon'}`;
const TODAY_KEY = () => new Date().toISOString().slice(0, 10);

function readState(userId) {
  try {
    const raw = localStorage.getItem(STATE_KEY(userId));
    if (!raw) return { completed: [], lastShownDate: null };
    const parsed = JSON.parse(raw);
    return {
      completed: Array.isArray(parsed.completed) ? parsed.completed : [],
      lastShownDate: parsed.lastShownDate || null,
    };
  } catch { return { completed: [], lastShownDate: null }; }
}

function writeState(userId, state) {
  try { localStorage.setItem(STATE_KEY(userId), JSON.stringify(state)); }
  catch { /* best-effort */ }
}

export default function OnboardingNudgeCard({ hasWorkouts = false, userEmail }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const navigate = useNavigate();
  const push = usePushSubscription();
  const [hidden, setHidden] = useState(false);

  // Quick count of users this person follows. Drives the "follow a
  // friend" nudge's skip condition. Lightweight — the hub_follows
  // table indexes follower_email so the count is cheap.
  const { data: followsCount = 0 } = useQuery({
    queryKey: ['onboardingFollowsCount', user?.email],
    queryFn: async () => {
      if (!user?.email) return 0;
      const { count } = await supabase
        .from('hub_follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_email', user.email);
      return count ?? 0;
    },
    enabled: !!user?.email,
    staleTime: 5 * 60_000, // 5 min — follows don't change fast
  });

  // Build the nudge config. Each entry has:
  //   • key                — localStorage marker
  //   • shouldShow(ctx)    — predicate; false skips this nudge entirely
  //   • title/body/cta     — i18n labels
  //   • icon               — lucide component
  //   • accent             — tailwind color
  //   • onAct()            — runs when the user taps the CTA
  const nudges = useMemo(() => [
    {
      key: 'first_workout',
      shouldShow: () => !hasWorkouts,
      title: tFallback('onboarding.first_workout.title', 'Log your first workout'),
      body:  tFallback('onboarding.first_workout.body',  'Two minutes. Just one set. The streak starts today.'),
      cta:   tFallback('onboarding.first_workout.cta',   'Start'),
      icon:  Dumbbell,
      accent: 'emerald',
      onAct: () => navigate('/workout'),
    },
    {
      key: 'enable_push',
      // Only relevant when push is supported, not already on, and not
      // hard-denied. If the user already dismissed PushOptInBanner, this
      // nudge still gives them one more chance.
      shouldShow: () => push.isSupported && !push.isSubscribed && push.permission !== 'denied',
      title: tFallback('onboarding.enable_push.title', 'Turn on notifications'),
      body:  tFallback('onboarding.enable_push.body',  'Stay looped in on your nemesis, your crew, and at-risk streaks.'),
      cta:   tFallback('onboarding.enable_push.cta',   'Enable'),
      icon:  Bell,
      accent: 'primary',
      onAct: async () => {
        const res = await push.subscribe();
        if (res.ok) {
          toast.success(tFallback('onboarding.enable_push.success', 'Notifications on — see you out there.'));
        }
      },
    },
    {
      key: 'follow_friend',
      shouldShow: () => followsCount === 0,
      title: tFallback('onboarding.follow_friend.title', 'Follow your first friend'),
      body:  tFallback('onboarding.follow_friend.body',  'Their workouts show up in your feed. Yours show up in theirs.'),
      cta:   tFallback('onboarding.follow_friend.cta',   'Find people'),
      icon:  UserPlus,
      accent: 'sky',
      onAct: () => navigate('/hub'),
    },
    {
      key: 'try_regimen',
      shouldShow: () => true,
      title: tFallback('onboarding.try_regimen.title', 'Try a regimen'),
      body:  tFallback('onboarding.try_regimen.body',  'Pre-built routines for legs, push, pull. No more guessing what to lift.'),
      cta:   tFallback('onboarding.try_regimen.cta',   'Browse'),
      icon:  ClipboardList,
      accent: 'amber',
      onAct: () => navigate('/workout'),
    },
    {
      key: 'share_week',
      shouldShow: () => hasWorkouts, // can't share a week with no workouts
      title: tFallback('onboarding.share_week.title', 'Share your week'),
      body:  tFallback('onboarding.share_week.body',  'A polished card of your stats. Post to Stories — it counts.'),
      cta:   tFallback('onboarding.share_week.cta',   'See it'),
      icon:  Share2,
      accent: 'rose',
      onAct: () => {
        // Scroll the weekly recap into view + open share card. The
        // recap card has its own share button; we just route there.
        const el = document.querySelector('[data-recap-card]');
        if (el?.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        else navigate('/dashboard');
      },
    },
    {
      key: 'invite_friend',
      shouldShow: () => true,
      title: tFallback('onboarding.invite_friend.title', 'Invite a friend'),
      body:  tFallback('onboarding.invite_friend.body',  'You both get 200 coins + an Elite capsule. Use your code.'),
      cta:   tFallback('onboarding.invite_friend.cta',   'Open'),
      icon:  Gift,
      accent: 'fuchsia',
      onAct: () => navigate('/hub/profile'),
    },
  ], [hasWorkouts, push, followsCount, navigate, tFallback]);

  // Pick the first nudge that's both uncompleted AND applicable. If
  // any are already shown today, suppress so we never double-prompt.
  const { nudge, suppressForToday } = useMemo(() => {
    if (!user?.id) return { nudge: null, suppressForToday: false };
    const state = readState(user.id);
    if (state.lastShownDate === TODAY_KEY()) {
      return { nudge: null, suppressForToday: true };
    }
    for (const n of nudges) {
      if (state.completed.includes(n.key)) continue;
      if (!n.shouldShow()) continue;
      return { nudge: n, suppressForToday: false };
    }
    return { nudge: null, suppressForToday: false };
  }, [user?.id, nudges]);

  const markCompleted = (key) => {
    if (!user?.id) return;
    const state = readState(user.id);
    if (!state.completed.includes(key)) state.completed.push(key);
    state.lastShownDate = TODAY_KEY();
    writeState(user.id, state);
  };

  const handleAct = async () => {
    if (!nudge) return;
    setHidden(true); // optimistic local hide; suppress re-render this session
    markCompleted(nudge.key);
    try { await nudge.onAct(); }
    catch (err) {
      console.warn('[onboarding] nudge action threw:', err?.message || err);
    }
  };

  const handleDismiss = () => {
    if (!nudge) return;
    setHidden(true);
    markCompleted(nudge.key);
  };

  if (!user?.id || !nudge || hidden || suppressForToday) return null;

  // Accent color → tailwind classes. Each nudge has a distinct hue so
  // a returning user feels the variety across days. Keep the mapping
  // explicit (tailwind needs literal class names to keep them in the
  // production CSS bundle).
  const ACCENT = {
    emerald: { bg: 'bg-emerald-500/8',  border: 'border-emerald-500/30', text: 'text-emerald-500', btn: 'bg-emerald-500 hover:bg-emerald-600' },
    primary: { bg: 'bg-primary/8',      border: 'border-primary/30',     text: 'text-primary',     btn: 'bg-primary hover:bg-primary/90' },
    sky:     { bg: 'bg-sky-500/8',      border: 'border-sky-500/30',     text: 'text-sky-500',     btn: 'bg-sky-500 hover:bg-sky-600' },
    amber:   { bg: 'bg-amber-500/8',    border: 'border-amber-500/30',   text: 'text-amber-500',   btn: 'bg-amber-500 hover:bg-amber-600' },
    rose:    { bg: 'bg-rose-500/8',     border: 'border-rose-500/30',    text: 'text-rose-500',    btn: 'bg-rose-500 hover:bg-rose-600' },
    fuchsia: { bg: 'bg-fuchsia-500/8',  border: 'border-fuchsia-500/30', text: 'text-fuchsia-500', btn: 'bg-fuchsia-500 hover:bg-fuchsia-600' },
  };
  const c = ACCENT[nudge.accent] || ACCENT.primary;
  const Icon = nudge.icon;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4, transition: { duration: 0.18 } }}
        transition={{ duration: 0.35 }}
        className={`relative overflow-hidden rounded-lg border ${c.border} ${c.bg} px-3 py-2.5 flex items-start gap-3`}
        role="region"
        aria-label={nudge.title}
      >
        <div className={`shrink-0 mt-0.5 w-8 h-8 rounded-md ${c.bg} ${c.text} flex items-center justify-center`}>
          <Icon className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-heading font-bold leading-tight">
            {nudge.title}
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">
            {nudge.body}
          </p>
          <button
            onClick={handleAct}
            className={`mt-2 inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold text-white transition-colors ${c.btn}`}
          >
            {nudge.cta}
            <ArrowRight className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 -mr-1 -mt-1 p-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors"
          aria-label={tFallback('onboarding.dismiss', 'Dismiss')}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
