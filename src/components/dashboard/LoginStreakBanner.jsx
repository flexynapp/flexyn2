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
        keep the (already busy) dashboard clean.
        NOTE: tapping the LABEL used to copy "N-day login streak" to the
        clipboard (TapToCopy). That is gone — nobody needs a streak on their
        clipboard, and it made the pill two controls in one chip, which a
        review had already misread as a single dead toggle. The chevron below
        is now the only control, and it expands the calendar. */}
    <motion.div
      initial={{ opacity: 0, y: -6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      className={`inline-flex items-center gap-1.5 ps-2 pe-1 py-0.5 rounded-full border ${
        onHero ? 'bg-white/10 border-white/20' : 'bg-primary/10 border-primary/20'
      }`}
    >
      <StreakFlame days={streak} size={15} className="shrink-0" />
      {/* cq-wrap: this pill now shares a row with Daily Quests, so it can
          be ~168px wide. English fits with room; a longer locale string
          would overflow, so allow it to wrap in a narrow container only. */}
      <span className={`text-xs whitespace-nowrap cq-wrap ${onHero ? 'text-white' : ''}`}>
          <span className="font-heading font-bold tabular-nums">
            <AnimatedNumber value={streak} />
          </span>
          <span className={onHero ? 'text-white/75' : 'text-muted-foreground'}> {streak === 1 ? t('dashboard.dayStreak') : t('dashboard.daysStreak')}</span>
          {/* On the hero the backdrop is the gold CTA gradient, where brand
              orange has almost no separation — white is what the sibling
              spans already use there. Off-hero it sits on a neutral card
              and takes the brand accent. */}
          {isPersonalBest && (
            <span className={`ms-1.5 text-micro font-bold uppercase tracking-wider ${onHero ? 'text-white' : 'text-primary'}`}>
              {t('dashboard.best')}
            </span>
          )}
      </span>
      <button
        type="button"
        onClick={() => setShowCalendar(v => !v)}
        // `before:` expands the TAP target to ~44px without changing the
        // rendered size, so the pill keeps its compact look while the
        // control becomes reachable with a thumb. p-0.5 around a 14px icon
        // gave it an ~18px hit box — well under the 44px minimum, and the
        // reason a tap aimed at the chevron landed on the copy-to-clipboard
        // label beside it and appeared to do nothing.
        // active: states are the app-wide press feedback.
        className={`relative flex items-center rounded-full p-0.5 transition-colors
          before:absolute before:content-[''] before:-inset-3 ${
          onHero ? 'text-white/60 hover:text-white active:text-white hover:bg-white/10 active:bg-white/10' : 'text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary/40 active:bg-secondary/60'
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
