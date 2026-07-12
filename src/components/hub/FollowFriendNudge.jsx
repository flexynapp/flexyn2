// src/components/hub/FollowFriendNudge.jsx
//
// "Follow your first friend" nudge — lives on the Hub feed, directly
// above the friends-only weekly leaderboard (which reads as empty until
// you follow someone). Moved here from the Dashboard onboarding rotation
// (OnboardingNudgeCard) because the follow action actually happens on the
// Hub: tapping the CTA opens the people search right where the user
// already is.
//
// Shows only when the user follows nobody yet, and is dismissible for the
// session. Styling mirrors the dashboard nudge (sky accent, UserPlus).

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, ArrowRight, X } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { supabase } from '@/api/supabaseClient';

export default function FollowFriendNudge({ onFindPeople }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const [hidden, setHidden] = useState(false);

  // Cheap count — hub_follows indexes follower_email. Skip the nudge the
  // moment the user follows anyone.
  const { data: followsCount = 0, isLoading } = useQuery({
    queryKey: ['hubFollowFriendNudgeCount', user?.email],
    queryFn: async () => {
      if (!user?.email) return 0;
      const { count } = await supabase
        .from('hub_follows')
        .select('id', { count: 'exact', head: true })
        .eq('follower_email', user.email);
      return count ?? 0;
    },
    enabled: !!user?.email,
    staleTime: 5 * 60_000,
  });

  if (!user?.email || hidden || isLoading || followsCount > 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4, transition: { duration: 0.18 } }}
        transition={{ duration: 0.35 }}
        className="relative overflow-hidden rounded-lg border border-sky-500/30 bg-sky-500/8 px-2.5 py-1.5 flex items-center gap-2"
        role="region"
        aria-label={tFallback('onboarding.follow_friend.title', 'Follow your first friend')}
      >
        <div className="shrink-0 w-6 h-6 rounded-md bg-sky-500/8 text-sky-500 flex items-center justify-center">
          <UserPlus className="w-3 h-3" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-heading font-bold leading-tight">
            {tFallback('onboarding.follow_friend.title', 'Follow your first friend')}
          </p>
          <p className="text-[10px] text-muted-foreground leading-snug truncate">
            {tFallback('onboarding.follow_friend.body', 'Their workouts show up in your feed. Yours show up in theirs.')}
          </p>
        </div>
        <button
          onClick={() => { setHidden(true); onFindPeople?.(); }}
          className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold text-white transition-colors bg-sky-500 hover:bg-sky-600"
        >
          {tFallback('onboarding.follow_friend.cta', 'Find people')}
          <ArrowRight className="w-2.5 h-2.5 rtl:scale-x-[-1]" aria-hidden="true" />
        </button>
        <button
          onClick={() => setHidden(true)}
          className="shrink-0 -me-1 p-1.5 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors"
          aria-label={tFallback('onboarding.dismiss', 'Dismiss')}
        >
          <X className="w-3 h-3" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
