// src/components/dashboard/LeagueStandingsModal.jsx
//
// Full league standings: all 30 (or fewer) members of this week's bracket,
// ranked by days trained and then XP. The prize zone is highlighted green at
// the top. The race pays coins and never moves anyone's league; that is the
// Strength Score's job, shown in the header.

import React, { useState, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowUp, Crown, Dumbbell, Trophy, HelpCircle } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import * as leagues from '@/lib/data/leagues';
import * as leagueSeasons from '@/lib/data/leagueSeasons';
import { MIN_QUALIFIED_FOR_PRIZE, getTier, leagueTierName } from '@/lib/leagueTiers';
import { LeagueTierBadge } from '@/components/leagues/LeagueTierIcon';
import PlayerMenu from '@/components/report/PlayerMenu';
import LeagueQuests from '@/components/leagues/LeagueQuests';
// Explainer for the ladder. Lazy — it opens on a tap and most sessions
// never open it, so it has no business in the dashboard chunk.
const LeagueInfoSheet = React.lazy(() => import('@/components/dashboard/LeagueInfoSheet'));
import { differenceInCalendarDays, parseISO } from 'date-fns';

export default function LeagueStandingsModal({ open, onClose }) {
  const { user } = useAuth();
  const { t, tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const navigate = useNavigate();

  // Tapping a non-self row opens that user's Hub profile (uses the
  // existing ?profile=<email> deep-link contract that Hub.jsx parses).
  // Self row stays visual — there's no value in navigating to your
  // own profile from your own league standings.
  const openMemberProfile = (member) => {
    if (!member?.user_id || member.user_id === user?.id) return;
    onClose();
    navigate(`/hub?profile=${encodeURIComponent(member.user_id)}`);
  };

  const { data, isLoading } = useQuery({
    queryKey: ['myLeague', user?.id],
    queryFn: () => leagues.getMyLeague(user),
    enabled: !!user?.id && open,
    staleTime: 15_000,
  });

  const { data: strength } = useQuery({
    queryKey: ['myLeagueStrength', user?.id],
    queryFn: () => leagues.getMyStrength(user),
    enabled: !!user?.id && open,
    staleTime: 60_000,
  });

  // Season rides alongside the bracket rather than inside it: the week decides
  // where you move, the season decides what you keep. Returns null on a host
  // without migration 312, and the header simply omits the line.
  const { data: season } = useQuery({
    queryKey: ['myLeagueSeason', user?.id],
    queryFn: () => leagueSeasons.getMySeason(user),
    enabled: !!user?.id && open,
    staleTime: 60_000,
  });

  // No scroll lock here on purpose: this is a Radix <Dialog>, and Radix
  // pins the page itself (react-remove-scroll). The hand-rolled
  // body-overflow copy that used to sit here was a second, weaker
  // mechanism doing the same job — see @/lib/scrollLock for which
  // surfaces actually need ours.

  const [infoOpen, setInfoOpen] = useState(false);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[88vh] overflow-y-auto p-0 gap-0">
        {/* Skeleton only while loading. getMyLeague resolves null on an
            error or when the user has no league, and gating on !data here
            left that case on a skeleton forever. Body has the empty state. */}
        {isLoading ? (
          <div className="p-6 space-y-2">
            <Skeleton className="h-24 rounded-lg" />
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : (
          <Body data={data} season={season} strength={strength} userId={user?.id} t={t} tFallback={tFallback} fmt={fmt} onOpenMember={openMemberProfile} onOpenInfo={() => setInfoOpen(true)} />
        )}
      </DialogContent>

      {infoOpen && (
        <Suspense fallback={null}>
          <LeagueInfoSheet open={infoOpen} onClose={() => setInfoOpen(false)} tierId={data?.tier?.id} level={data?.level} score={strength?.score} />
        </Suspense>
      )}
    </Dialog>
  );
}

function Body({ data, season, strength, userId, t, tFallback, fmt, onOpenMember, onOpenInfo }) {
  // Defensive: if anything's missing, render an empty-state instead of crashing
  if (!data || !data.league || !data.tier || !Array.isArray(data.members)) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {tFallback('league.empty', 'No members yet. Earn XP to join the standings!')}
        </p>
      </div>
    );
  }
  const { league, tier, members, totalMembers, level = 1 } = data;
  // The prize zone is proportional to the QUALIFIED field and computed by
  // the data layer, which mirrors resolve_league_bracket_internal.
  const qualifiedCount = Number(data.qualifiedCount) || 0;
  const prizeN = Number(data.prizeN) || 0;
  const bracketTooSmall = !!data.bracketTooSmall;
  const mixed = !!data.mixedBracket;
  const endDate  = parseISO(league.week_end + 'T23:59:59');
  const daysLeft = Math.max(0, differenceInCalendarDays(endDate, new Date()) + 1);
  const preSeason = leagueSeasons.isPreSeason(season);
  const seasonDaysLeft = leagueSeasons.daysLeftInSeason(season);
  const seasonDaysUntil = leagueSeasons.daysUntilSeason(season);
  const seasonEligible = leagueSeasons.isSeasonEligible(season);

  return (
    <>
      {/* Header. It was a full-bleed tier gradient under white text, which
          failed contrast on Gold and Platinum and put violet on Diamond.
          The tier colour now lives in the league emblem, the same one the
          Today card uses, and the rest sits on the dialog surface. */}
      <div className="relative px-5 pt-6 pb-5 border-b border-border">
        <DialogHeader>
          <DialogTitle className="font-heading text-xl flex items-center gap-2 pe-8">
            <LeagueTierBadge tier={tier.id} level={level} size={40} />
            {leagueTierName(tier, tFallback, level)}
          </DialogTitle>
        </DialogHeader>
        {/* The header states the rules of THIS week ("0 qualified — 5 needed")
            without ever stating the system. This is the way in to the ladder.
            Sits under the X rather than beside it: 44px target, and the two
            must not collide at 375pt. */}
        <button
          type="button"
          onClick={onOpenInfo}
          className="absolute top-12 end-3 w-11 h-11 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={tFallback('league.info.open', 'How it works')}
        >
          <HelpCircle className="w-5 h-5" aria-hidden="true" />
        </button>
        {/* Season line. The bracket says where you are this week; this says
            what you are playing for over the 28 days, and whether you have
            done enough to collect. Omitted entirely on a host without
            migration 312 rather than rendering a placeholder. */}
        {season?.season_number != null && (
          // pe-12 keeps the row clear of the help button beside it, which
          // the French "1 sur 2 semaines" pill ran underneath. The name is
          // built here because the server's is English in every locale.
          <div className="mt-1 pe-12 flex items-center gap-2 flex-wrap">
            <span className="text-xs font-semibold">
              {tFallback('league.season', 'Season')} {fmt(season.season_number)}
            </span>
            {/* Pre-season counts DOWN to the opening rather than reporting a
                progress bar nobody can move yet. Weekly promotion still runs
                throughout — only the season reward is waiting. */}
            {preSeason ? (
              <span className="text-micro text-muted-foreground">
                {seasonDaysUntil != null
                  ? tFallback('league.season.startsIn', 'starts in {n}d', { n: seasonDaysUntil })
                  : tFallback('league.season.notStarted', 'not started yet')}
              </span>
            ) : (
              seasonDaysLeft != null && (
                <span className="text-micro text-muted-foreground">
                  {tFallback('league.season.endsIn', 'ends in {n}d', { n: seasonDaysLeft })}
                </span>
              )
            )}
            <span
              className={`text-micro font-bold px-1.5 py-0.5 rounded-full ${
                seasonEligible ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
              }`}
            >
              {preSeason
                ? tFallback('league.season.preSeason', 'Pre-season')
                : seasonEligible
                ? tFallback('league.season.secured', 'Reward secured')
                : tFallback('league.season.progress', '{n} of {need} weeks', {
                    n: season.weeks_qualified ?? 0,
                    need: season.weeks_needed ?? 2,
                  })}
            </span>
          </div>
        )}
        {/* Strength: the number that decides this league. The bracket below
            is only the week's race. */}
        {strength && (
          <div className="mt-3 flex items-center gap-2 text-sm">
            <Dumbbell className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
            {strength.score != null ? (
              <p className="min-w-0">
                <span className="font-heading font-bold tabular-nums">{fmt(Math.round(strength.score))}</span>{' '}
                <span className="text-muted-foreground">
                  {strength.next_tier
                    ? tFallback('league.strength.headerNext', 'Strength Score. {tier} at {floor}', {
                        tier: leagueTierName(getTier(strength.next_tier), tFallback),
                        floor: fmt(strength.next_floor),
                      })
                    : tFallback('league.strength.headerTop', 'Strength Score. The top of the ladder')}
                  {strength.bodyweight_given === false && (
                    <>. {tFallback('league.strength.addBodyweightShort', 'Add your bodyweight to go past Gold.')}</>
                  )}
                </span>
              </p>
            ) : (
              <p className="text-muted-foreground min-w-0">
                {strength.basis === 'onboarding'
                  ? tFallback('league.strength.provisional', 'Placed from your answers. Log two sessions of a press, squat or deadlift to confirm')
                  : tFallback('league.strength.needLiftsAny', 'Log two sessions of a press, squat or deadlift to get placed')}
              </p>
            )}
          </div>
        )}
        <div className="mt-3 flex items-center gap-4 text-sm flex-wrap">
          <div className="flex items-center gap-1.5">
            <Trophy className="w-4 h-4" />
            <span>{totalMembers} {tFallback('league.members', 'members')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="kicker">
              {tFallback('league.daysLeft', 'Days left')}
            </span>
            <span className="font-heading font-bold tabular-nums">{daysLeft}</span>
          </div>
          {prizeN > 0 && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <ArrowUp className="w-3.5 h-3.5 text-success" />
              <span className="text-xs">
                {tFallback('league.topPrize', 'Top {n} win the prize', { n: prizeN })}
              </span>
            </div>
          )}
          {/* Below the minimum qualified field nobody takes the top prize.
              Saying so is the difference between "the league is broken" and
              "the league has a rule". */}
          {bracketTooSmall && (
            <div className="flex items-center gap-1 text-muted-foreground">
              <span className="text-xs">
                {tFallback(
                  'league.gate.prizeHeld',
                  '{n} qualified. {need} needed for the top prize',
                  { n: qualifiedCount, need: MIN_QUALIFIED_FOR_PRIZE },
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Weekly league quests: extra points toward this week's standings. */}
      <LeagueQuests userId={userId} t={t} tFallback={tFallback} fmt={fmt} />

      {/* Members list */}
      <div className="p-4 sm:p-5 md:p-6">
        {members.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title={tFallback('league.emptyTitle', 'Empty league')}
            body={tFallback('league.empty', 'No members yet. Earn XP to join the standings!')}
          />
        ) : (
          <AnimatePresence>
            <div className="space-y-1.5">
              {members.map((m, idx) => {
                // Unqualified members carry rankInBracket === null and render
                // as "Unranked". They are not competing, so they cannot be in
                // the prize zone no matter where they sit in the list.
                const rank = m.rankInBracket ?? null;
                const unranked = !m.isQualified;
                const isMe = m.user_id === userId;
                const isPrize = !unranked && prizeN > 0 && rank <= prizeN;
                const isFirst = rank === 1;
                const days = Number(m.active_days) || 0;

                // m.email never existed on these rows (the column is
                // user_email), so no row ever opened a profile. The id is what
                // openMemberProfile navigates by anyway.
                const interactive = !isMe && !!m.user_id;
                return (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: Math.min(idx, 12) * 0.025 }}
                    onClick={interactive ? () => onOpenMember?.(m) : undefined}
                    role={interactive ? 'button' : undefined}
                    tabIndex={interactive ? 0 : undefined}
                    onKeyDown={interactive ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenMember?.(m); }
                    } : undefined}
                    aria-label={interactive ? tFallback('league.openMember', 'Open {name}', { name: m.username || m.full_name || 'member' }) : undefined}
                    className={[
                      'flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors',
                      interactive ? 'cursor-pointer hover:bg-secondary/40 active:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40' : '',
                      isMe
                        ? 'bg-primary/10 border-primary/40 ring-1 ring-primary/30'
                        : isPrize
                        ? 'bg-success/5 border-success/20'
                        : unranked
                        ? 'bg-transparent border-border/30'
                        : 'bg-card border-border/40',
                      unranked ? 'opacity-60' : '',
                    ].join(' ')}
                  >
                    <div className="w-8 flex items-center justify-center">
                      {isFirst ? (
                        <Crown className="w-4 h-4 text-primary" />
                      ) : unranked ? (
                        <span className="text-xs text-muted-foreground/50" aria-hidden="true">—</span>
                      ) : (
                        <span className="font-heading font-bold text-xs tabular-nums text-muted-foreground">
                          #{rank}
                        </span>
                      )}
                    </div>
                    {/* In a mixed bracket each member's own league shows,
                        because it is what sets their purse. */}
                    {mixed && (
                      <LeagueTierBadge tier={getTier(m.tier || league.tier).id} size={20} />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-heading font-bold text-sm truncate">
                        {/* Prefer username over email-local-part. The
                            previous fallback to the email local-part
                            leaked the email username portion to every
                            other league member — a corporate signup like
                            "j.smith.cfo@acme.com" exposed the user's work
                            handle to ~29 strangers each week. Username
                            comes from the league_members + user_profiles
                            embed; falls through to "Athlete" if neither
                            is set. (Audit 15 #H5.) */}
                        {isMe
                          ? tFallback('progress.you', 'You')
                          : (m.username || m.user?.username || 'Athlete')}
                      </p>
                      {/* The one line that makes the rule legible: a member
                          with XP but no session is sitting below people who
                          scored less, and this says why. */}
                      {unranked && (
                        <p className="text-micro text-muted-foreground">
                          {tFallback('league.gate.notQualified', 'No workout logged this week')}
                        </p>
                      )}
                    </div>
                    <div className="text-end">
                      <p className="font-heading font-bold text-sm tabular-nums">
                        {tFallback('league.daysShort', '{n}d', { n: days })}
                      </p>
                      <p className="text-micro text-muted-foreground tabular-nums">
                        {fmt(m.weekly_xp || 0)} XP
                      </p>
                    </div>
                    <PlayerMenu
                      userId={m.user_id}
                      currentUserId={userId}
                      username={m.username || m.user?.username}
                      context="league"
                      contextId={league.id}
                    />
                  </motion.div>
                );
              })}
            </div>
          </AnimatePresence>
        )}

        {/* Key. Only when the prize zone is drawn above. */}
        {prizeN > 0 && (
          <div className="mt-5 pt-4 border-t border-border flex items-center gap-4 text-micro text-muted-foreground flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-sm bg-success/30" />
              <span>{tFallback('league.prizeZone', 'Prize zone')}</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
