// src/components/dashboard/LoginStreakBanner.jsx
//
// Compact streak indicator on the Dashboard. PURELY DISPLAY — the
// recordLogin() side-effect (writes last_login_date, fires toast +
// in-app notification) used to live here, but that meant users who
// opened the app and never visited /dashboard didn't update their
// last_login_date. The welcome-back cron (migration 037) saw them as
// inactive even though they were using the app daily. Moved to the
// global LoginStreakSync component which mounts at the App level.

import React from 'react';
import { motion } from 'framer-motion';
import { Flame, Snowflake } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';

export default function LoginStreakBanner() {
  const { user } = useAuth();
  const { t } = useLanguage();

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
          <span className="text-muted-foreground"> {streak === 1 ? t('dashboard.dayStreak') : t('dashboard.daysStreak')}</span>
          {isPersonalBest && (
            <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-orange-500">
              {t('dashboard.best')}
            </span>
          )}
        </span>
      </div>
      {freezes > 0 && (
        <div
          className="flex items-center gap-1 text-[11px] text-cyan-500"
          title={(freezes === 1 ? t('dashboard.streakFreezeTooltip') : t('dashboard.streakFreezesTooltip')).replace('{n}', freezes)}
        >
          <Snowflake className="w-3 h-3" />
          <span className="tabular-nums">×{freezes}</span>
        </div>
      )}
    </motion.div>
  );
}
