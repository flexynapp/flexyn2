// src/components/dashboard/LoginStreakBanner.jsx
//
// Compact streak indicator on the Dashboard. PURELY DISPLAY — the
// recordLogin() side-effect (writes last_login_date, fires toast +
// in-app notification) used to live here, but that meant users who
// opened the app and never visited /dashboard didn't update their
// last_login_date. The welcome-back cron (migration 037) saw them as
// inactive even though they were using the app daily. Moved to the
// global LoginStreakSync component which mounts at the App level.

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import StreakFlame from '@/components/StreakFlame';
import AnimatedNumber from '@/components/AnimatedNumber';
import TapToCopy from '@/components/TapToCopy';
import { useLanguage } from '@/lib/LanguageContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';
import StreakCalendarGrid from './StreakCalendarGrid';

export default function LoginStreakBanner({ variant = 'default' }) {
  const { user } = useAuth();
  const { t, tFallback } = useLanguage();
  // 'hero' variant sits on the dark hero card, so it needs light text and
  // a translucent-white pill instead of the orange-on-light default.
  const onHero = variant === 'hero';

  // Read the user's streak data
  const { data: profile } = useQuery({
    queryKey: ['loginStreakProfile', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data } = await safeSelect({
        columns: ['login_streak', 'last_login_date', 'longest_login_streak', 'streak_freezes_available'],
        build: (cols) => supabase
          .from('user_profiles')
          .select(cols)
          .eq('id', user.id)
          .maybeSingle(),
      });
      return data;
    },
    enabled: !!user?.id,
    staleTime: 30_000,
  });

  const [showCalendar, setShowCalendar] = useState(false);

  if (!user?.id) return null;
  const streak = profile?.login_streak ?? 0;
  if (streak === 0) return null; // hide on day 0; banner appears after first record

  const longest = profile?.longest_login_streak ?? streak;
  const isPersonalBest = streak === longest && streak > 1;

  return (
    <div>
    {/* Compact inline pill — hugs its content on the left instead of a
        full-width card, and the ember-particle overlay was dropped, to
        keep the (already busy) dashboard clean. Tap to expand the calendar. */}
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`inline-flex items-center gap-1.5 ps-2 pe-1 py-0.5 rounded-full border ${
        onHero ? 'bg-white/10 border-white/20' : 'bg-orange-500/10 border-orange-500/20'
      }`}
    >
      <StreakFlame days={streak} size={15} className="shrink-0" />
      <TapToCopy value={`${streak}-day login streak`} label="streak">
        <span className={`text-xs whitespace-nowrap ${onHero ? 'text-white' : ''}`}>
          <span className="font-heading font-bold tabular-nums">
            <AnimatedNumber value={streak} />
          </span>
          <span className={onHero ? 'text-white/75' : 'text-muted-foreground'}> {streak === 1 ? t('dashboard.dayStreak') : t('dashboard.daysStreak')}</span>
          {isPersonalBest && (
            <span className={`ms-1.5 text-[9px] font-bold uppercase tracking-wider ${onHero ? 'text-orange-300' : 'text-orange-500'}`}>
              {t('dashboard.best')}
            </span>
          )}
        </span>
      </TapToCopy>
      <button
        type="button"
        onClick={() => setShowCalendar(v => !v)}
        className={`flex items-center rounded-full p-0.5 transition-colors ${
          onHero ? 'text-white/60 hover:text-white hover:bg-white/10' : 'text-muted-foreground hover:text-foreground hover:bg-secondary/40'
        }`}
        aria-label={showCalendar
          ? tFallback('streakBanner.hideCalendar', 'Hide streak calendar')
          : tFallback('streakBanner.showCalendar', 'Show streak calendar')}
        aria-expanded={showCalendar}
      >
        {showCalendar ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </button>
    </motion.div>
    <AnimatePresence>
      {showCalendar && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="mt-2 overflow-hidden"
        >
          <StreakCalendarGrid profile={profile} />
        </motion.div>
      )}
    </AnimatePresence>
    </div>
  );
}
