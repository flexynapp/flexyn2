// src/components/dashboard/LeagueStandingsModal.jsx
//
// Full league standings — all 30 (or fewer) members ranked by weekly XP.
// Promotion zone is highlighted green at the top, demotion zone red at the
// bottom, holding-position grey in the middle.

import React, { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowUp, ArrowDown, Crown, Trophy } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import * as leagues from '@/lib/data/leagues';
import { MIN_QUALIFIED_TO_MOVE } from '@/lib/leagueTiers';
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

  // Lock body scroll while open to keep mobile users inside the modal scroller
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* The X sits on the tier's coloured hero, not on --background, so it
          takes black rather than the default foreground colour — and no
          focus halo, which on a touch device stays drawn after the tap and
          reads as a circle around the icon. Keyboard focus still lands on
          it; it just isn't ringed. */}
      <DialogContent
        className="max-w-2xl max-h-[88vh] overflow-y-auto p-0 gap-0"
        closeClassName="text-black opacity-100 hover:opacity-100 focus:ring-0 focus:ring-offset-0"
      >
        {isLoading || !data ? (
          <div className="p-6 space-y-2">
            <Skeleton className="h-24 rounded-lg" />
            {[1, 2, 3, 4, 5].map(i => <Skeleton key={i} className="h-14 rounded-lg" />)}
          </div>
        ) : (
          <Body data={data} userId={user?.id} t={t} tFallback={tFallback} fmt={fmt} onOpenMember={openMemberProfile} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({ data, userId, t, tFallback, fmt, onOpenMember }) {
  // Defensive: if anything's missing, render an empty-state instead of crashing
  if (!data || !data.league || !data.tier || !Array.isArray(data.members)) {
    return (
      <div className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          {tFallback('league.empty', 'No league standings available right now.')}
        </p>
      </div>
    );
  }
  const { league, tier, members, totalMembers } = data;
  // Zone sizes are proportional to the QUALIFIED field and computed by the
  // data layer, which mirrors migration 310. Reading tier.promote here — an
  // absolute count that no longer exists — is what let a 6-person bracket
  // render "top 10 promote" over every row on the board.
  const qualifiedCount = Number(data.qualifiedCount) || 0;
  const promoteN = Number(data.promoteN) || 0;
  const demoteN  = Number(data.demoteN) || 0;
  const bracketTooSmall = !!data.bracketTooSmall;
  const endDate  = parseISO(league.week_end + 'T23:59:59');
  const daysLeft = Math.max(0, differenceInCalendarDays(endDate, new Date()) + 1);

  return (
    <>
      {/* Hero */}
      <div className={`relative bg-gradient-to-br ${tier.gradient} px-5 pt-6 pb-7 text-white`}>
        <DialogHeader>
          <DialogTitle className="font-heading text-xl flex items-center gap-2 text-white drop-shadow pe-8">
            <span className="text-2xl">{tier.icon}</span>
            {tier.label} {tFallback('league.title', 'League')}
          </DialogTitle>
        </DialogHeader>
        <div className="mt-3 flex items-center gap-4 text-sm flex-wrap">
          <div className="flex items-center gap-1.5">
            <Trophy className="w-4 h-4" />
            <span>{totalMembers} {tFallback('league.members', 'members')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-micro font-bold uppercase tracking-wider opacity-80">
              {tFallback('league.daysLeft', 'Days left')}
            </span>
            <span className="font-heading font-bold tabular-nums">{daysLeft}</span>
          </div>
          {promoteN > 0 && (
            <div className="flex items-center gap-1 text-white/90">
              <ArrowUp className="w-3.5 h-3.5" />
              <span className="text-xs">
                {/* The {n} placeholder in the fallback string is
                    substituted by tFallback's vars argument. The
                    previous code template-literal'd promoteN INTO the
                    fallback, baked the number into the English copy,
                    AND tried to replace {n} which wasn't there — so
                    translators using {n} got "{n}" rendered verbatim.
                    (Audit 08 #22.) */}
                {tFallback('league.topPromoted', 'Top {n} promoted', { n: promoteN })}
              </span>
            </div>
          )}
          {demoteN > 0 && (
            <div className="flex items-center gap-1 text-white/90">
              <ArrowDown className="w-3.5 h-3.5" />
              <span className="text-xs">
                {tFallback('league.bottomDemoted', 'Bottom {n} demoted', { n: demoteN })}
              </span>
            </div>
          )}
          {/* Below the minimum qualified field nobody moves, in either
              direction. Saying so is the difference between "the league is
              broken" and "the league has a rule". */}
          {bracketTooSmall && (
            <div className="flex items-center gap-1 text-white/90">
              <span className="text-xs">
                {tFallback(
                  'league.bracketHeld',
                  '{n} qualified — {need} needed before anyone moves',
                  { n: qualifiedCount, need: MIN_QUALIFIED_TO_MOVE },
                )}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Members list */}
      <div className="p-4 sm:p-5 md:p-6">
        {members.length === 0 ? (
          <EmptyState
            icon={Trophy}
            title={tFallback('league.emptyTitle', 'Empty league')}
            body={tFallback('league.empty', 'No members yet — earn XP to join the standings!')}
          />
        ) : (
          <AnimatePresence>
            <div className="space-y-1.5">
              {members.map((m, idx) => {
                // Unqualified members carry rankInBracket === null and render
                // as "Unranked". They are not competing, so they can be in
                // neither zone no matter where they sit in the list.
                const rank = m.rankInBracket ?? null;
                const unranked = !m.isQualified;
                const isMe = m.user_id === userId;
                const isPromote = !unranked && promoteN > 0 && rank <= promoteN;
                const isDemote  = !unranked && demoteN > 0 && rank > qualifiedCount - demoteN;
                const isFirst = rank === 1;

                const interactive = !isMe && m.email;
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
                        : isPromote
                        ? 'bg-success/5 border-success/20'
                        : isDemote
                        ? 'bg-destructive/5 border-destructive/20'
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
                          {tFallback('league.notQualified', 'No workout logged this week')}
                        </p>
                      )}
                    </div>
                    <div className="text-end">
                      <p className="font-heading font-bold text-sm tabular-nums">
                        {fmt(m.weekly_xp || 0)} XP
                      </p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </AnimatePresence>
        )}

        {/* Legend */}
        <div className="mt-5 pt-4 border-t border-border flex items-center gap-4 text-micro text-muted-foreground flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-success/30" />
            <span>{tFallback('league.promoteZone', 'Promotion')}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 rounded-sm bg-destructive/30" />
            <span>{tFallback('league.demoteZone', 'Demotion')}</span>
          </div>
        </div>
      </div>
    </>
  );
}
