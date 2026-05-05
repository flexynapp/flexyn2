// src/components/dashboard/LoginStreakBanner.jsx
//
// Compact streak indicator on the Dashboard. Auto-records the login on mount
// (idempotent — only one credit per day). Shows a celebratory toast when a
// new streak day is recorded.

import React, { useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Flame, Snowflake } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as loginStreak from '@/lib/data/loginStreak';
import { supabase } from '@/api/supabaseClient';

export default function LoginStreakBanner() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const recordedRef = useRef(false);

  // Read the user's streak data
  const { data: profile } = useQuery({
    queryKey: ['loginStreakProfile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await supabase
        .from('user_profiles')
        .select('login_streak, last_login_date, longest_login_streak, streak_freezes_available')
        .eq('id', user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  // Record today's login exactly once per page load
  useEffect(() => {
    if (!user?.id) return;
    if (recordedRef.current) return;
    recordedRef.current = true;

    loginStreak.recordLogin(user).then((result) => {
      if (result.isNewDay && result.coinsAwarded > 0) {
        const msg = result.freezeUsed
          ? `Streak saved with a freeze! Day ${result.streak} · +${result.coinsAwarded} coins`
          : `Day ${result.streak} streak! +${result.coinsAwarded} coins`;
        toast.success(msg, { icon: '🔥', duration: 4500 });

        if (result.eliteCapsuleAwarded) {
          setTimeout(() => {
            toast.success(`Day ${result.streak} milestone — Elite Capsule unlocked!`, {
              icon: '💎',
              duration: 5000,
            });
          }, 600);
        }

        queryClient.invalidateQueries({ queryKey: ['loginStreakProfile'] });
        queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
        queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user?.email] });
      }
    }).catch((err) => {
      console.warn('[LoginStreakBanner] recordLogin failed:', err);
    });
  }, [user, queryClient]);

  if (!user?.id) return null;
  const streak = profile?.login_streak ?? 0;
  if (streak === 0) return null; // hide on day 0; banner appears after first record

  const longest = profile?.longest_login_streak ?? streak;
  const freezes = profile?.streak_freezes_available ?? 0;
  const isPersonalBest = streak === longest && streak > 1;

  return (
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-orange-500/10 border border-orange-500/20"
    >
      <div className="flex items-center gap-2 min-w-0">
        <Flame className="w-4 h-4 text-orange-500 shrink-0" />
        <span className="text-sm">
          <span className="font-heading font-bold tabular-nums">{streak}</span>
          <span className="text-muted-foreground"> day streak</span>
          {isPersonalBest && (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-orange-500">
              Best
            </span>
          )}
        </span>
      </div>
      {freezes > 0 && (
        <div
          className="flex items-center gap-1 text-[11px] text-cyan-500"
          title={`${freezes} streak freeze${freezes === 1 ? '' : 's'} — auto-spent if you miss a day`}
        >
          <Snowflake className="w-3 h-3" />
          <span className="tabular-nums">×{freezes}</span>
        </div>
      )}
    </motion.div>
  );
}
