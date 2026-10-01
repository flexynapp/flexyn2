// src/components/leagues/LeagueQuests.jsx
//
// This week's league quests, in the standings sheet. Each one pays league
// points (weekly XP) once per league week. Progress and payment are the
// server's (get_my_league_quests / claim_league_quest), so a row only turns
// claimable when the server already counts the work.
//
// Feedback stays on the row: the check fills, the title strikes through and
// the points rise off it. No toast.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { QuestCheck } from '@/components/dashboard/DailyQuestsCard';
import { getMyLeagueQuests, claimLeagueQuest } from '@/lib/data/leaguePoints';
import { reportError } from '@/lib/reportError';
import { triggerHaptic } from '@/lib/haptic';

const LABELS = {
  train_2:      'Train 2 days',
  train_4:      'Train 4 days',
  cardio_2:     'Log 2 cardio sessions of 10 min or more',
  water_3:      'Reach your water goal on 3 days',
  scan_meals_3: 'Scan a meal by photo or barcode on 3 days',
  bounty_1:     'Complete a bounty',
};

export default function LeagueQuests({ userId, t, tFallback, fmt }) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(null);
  const [failed, setFailed] = useState(null);
  const [risen, setRisen] = useState(null);

  const { data } = useQuery({
    queryKey: ['myLeagueQuests', userId],
    queryFn: getMyLeagueQuests,
    enabled: !!userId,
    staleTime: 15_000,
  });

  const quests = Array.isArray(data?.quests) ? data.quests : [];
  if (quests.length === 0) return null;

  const claim = async (q) => {
    if (pending) return;
    setPending(q.quest_id);
    setFailed(null);
    try {
      const res = await claimLeagueQuest(q.quest_id);
      if (res?.success) {
        triggerHaptic('success');
        setRisen({ id: q.quest_id, xp: Number(res.xp_awarded) || 0 });
      } else if (res?.reason !== 'already_claimed' && res?.reason !== 'not_met') {
        setFailed(q.quest_id);
      }
      queryClient.invalidateQueries({ queryKey: ['myLeagueQuests', userId] });
      queryClient.invalidateQueries({ queryKey: ['myLeague', userId] });
    } catch (err) {
      reportError(err, { feature: 'leagues.quest-claim', level: 'warning' });
      setFailed(q.quest_id);
    } finally {
      setPending(null);
    }
  };

  const banked = quests.reduce((sum, q) => sum + (q.claimed ? Number(q.xp_awarded) || 0 : 0), 0);

  return (
    <section className="border-b border-border" aria-labelledby="league-quests-title">
      <div className="flex items-baseline gap-2 px-4 sm:px-5 md:px-6 pt-4 pb-1">
        <h3 id="league-quests-title" className="font-heading font-bold text-sm tracking-tight">
          {tFallback('league.quests.title', 'League quests')}
        </h3>
        <span className="ms-auto font-heading font-bold text-xs tabular-nums text-muted-foreground">
          {tFallback('league.quests.banked', '{n} XP this week', { n: fmt(banked) })}
        </span>
      </div>
      <p className="px-4 sm:px-5 md:px-6 pb-2 text-xs text-muted-foreground">
        {tFallback('league.quests.sub', 'Points count toward this week\'s standings.')}
      </p>
      <div>
        {quests.map((q) => {
          const ready = !q.claimed && Number(q.progress) >= Number(q.target);
          const label = tFallback(`league.quest.${q.quest_id}`, LABELS[q.quest_id] || q.quest_id);
          const xp = q.claimed ? Number(q.xp_awarded) || 0 : Number(q.xp) || 0;
          return (
            <div
              key={q.quest_id}
              className="relative flex items-center gap-3 min-h-12 px-4 sm:px-5 md:px-6 border-t border-border"
            >
              <QuestCheck ready={ready} done={!!q.claimed} />
              <div className="min-w-0 flex-1 py-2.5">
                <p className={`relative text-sm font-medium leading-tight transition-colors duration-300 ${q.claimed ? 'text-muted-foreground' : ''}`}>
                  {label}
                  <span
                    aria-hidden="true"
                    className="absolute start-0 top-[55%] h-px bg-muted-foreground transition-[width] duration-500 delay-100 motion-reduce:transition-none"
                    style={{ width: q.claimed ? '100%' : 0 }}
                  />
                </p>
                {!q.claimed && Number(q.target) > 1 && (
                  <span className="block mt-0.5 text-micro text-muted-foreground tabular-nums">
                    {tFallback('league.quests.progress', '{n} of {target}', { n: fmt(q.progress), target: fmt(q.target) })}
                  </span>
                )}
                {failed === q.quest_id && (
                  <span className="block mt-0.5 text-micro text-destructive">
                    {tFallback('league.quests.claimError', 'Could not claim. Try again.')}
                  </span>
                )}
              </div>
              <span
                className={`text-xs font-semibold tabular-nums shrink-0 transition-colors duration-300 ${
                  q.claimed || ready ? 'text-success' : 'text-muted-foreground'
                }`}
              >
                +{fmt(xp)} XP
              </span>
              <AnimatePresence initial={false}>
                {ready && (
                  <motion.button
                    key="claim"
                    type="button"
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.85, opacity: 0 }}
                    whileTap={{ scale: 0.94 }}
                    disabled={pending === q.quest_id}
                    onClick={() => claim(q)}
                    className="px-3 py-1 rounded-sm bg-success text-success-foreground text-xs font-bold hover:brightness-110 disabled:opacity-60 shrink-0"
                  >
                    {t('dashboard.claim')}
                  </motion.button>
                )}
              </AnimatePresence>
              <AnimatePresence>
                {risen?.id === q.quest_id && risen.xp > 0 && (
                  <motion.span
                    key={`rise-${q.quest_id}`}
                    aria-hidden="true"
                    initial={{ opacity: 0, y: 0 }}
                    animate={{ opacity: [0, 1, 0], y: -28 }}
                    transition={{ duration: 0.9, ease: 'easeOut' }}
                    onAnimationComplete={() => setRisen(null)}
                    className="pointer-events-none absolute end-6 top-2 font-heading font-extrabold text-sm text-success tabular-nums"
                  >
                    +{fmt(risen.xp)}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
