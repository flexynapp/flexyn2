// src/components/crews/CrewPage.jsx
//
// The Crew page — what tapping a Crew opens.
//
// It used to open CrewChat directly, so a Crew was a message thread and
// everything describing it (level, division, war, treasury, roster) lived
// behind a slide-in panel or on a different tab. Migrations 248-251 gave a
// Crew a lot of state and none of it was visible from the Crew itself; a
// member three days into a war their crew was losing saw no sign of it.
//
// Both references in docs/crew-page-research.md open the group as a subject:
// Habitica leads with an h1 of the group name and the leader beneath it,
// with chat as a section inside the page; Voyager opens with identity, one
// stats line and a description. Chat is now a tab here for the same reason.
//
// Built to docs/profile-ui-premium-research.md: the crest is punched over
// the banner seam and ringed in the page background rather than a border
// colour, metrics are one text row taking hierarchy from weight and colour
// instead of tiles, the type scale is four sizes, counts go through
// useNumberFormatter, and one control is primary.

import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Shield, Settings, UserPlus } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useNumberFormatter } from '@/lib/intl';
import * as crewsData from '@/lib/data/crews';
import { getDivisionStandings, placingFor, crewLevelProgress } from '@/lib/data/crewSeasons';
import { getTreasury } from '@/lib/data/crewTreasury';
import { toast } from '@/lib/toast';
import ChatViewportFrame from '@/components/ChatViewportFrame';
import CrewChat from './CrewChat';
import CrewBattleEntry from './CrewBattleEntry';
import { rankOf, can } from '@/lib/crewPermissions';
import CrewChallengeCard from './CrewChallengeCard';
import CrewLeaguePanel from './CrewLeaguePanel';
import CrewMemberDirectory from './CrewMemberDirectory';
import CrewTrophiesPanel from './CrewTrophiesPanel';
import CrewSettingsSheet from './CrewSettingsSheet';
import CrewInviteSheet from './CrewInviteSheet';

// Five tabs still fit 390px at `gap-5 px-4` — measured, not assumed.
const TABS = [
  { key: 'home',     label: 'Home' },
  { key: 'roster',   label: 'Roster' },
  { key: 'chat',     label: 'Chat' },
  { key: 'league',   label: 'League' },
  { key: 'trophies', label: 'Trophies' },
];

const ORDINAL = { one: 'st', two: 'nd', few: 'rd', other: 'th' };
function ordinal(n) {
  if (!Number.isFinite(n)) return null;
  try {
    return `${n}${ORDINAL[new Intl.PluralRules('en-US', { type: 'ordinal' }).select(n)] ?? 'th'}`;
  } catch {
    return String(n);
  }
}

export default function CrewPage({ crew, onBack, onViewProfile }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const fmt = useNumberFormatter();
  const [tab, setTab] = useState('home');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const qc = useQueryClient();

  const crewId = crew?.id;

  const { data: members = [] } = useQuery({
    queryKey: ['crewMembers', crewId],
    queryFn:  () => crewsData.getCrewMembers(crewId),
    enabled:  !!crewId,
    staleTime: 30_000,
  });

  const { data: standings } = useQuery({
    queryKey: ['crewStandings', crewId],
    queryFn:  () => getDivisionStandings(crewId),
    enabled:  !!crewId,
    staleTime: 60_000,
  });

  const { data: treasury } = useQuery({
    queryKey: ['crewTreasury', crewId],
    queryFn:  () => getTreasury(crewId),
    enabled:  !!crewId,
    staleTime: 60_000,
  });

  // Leaving is the only way out now that a user belongs to one crew
  // (migration 252). Every refusal is a normal situation with its own thing
  // to do about it, so each gets its own sentence rather than "failed".
  const leaveMut = useMutation({
    mutationFn: () => crewsData.leaveCrew(crewId),
    onSuccess: (res) => {
      if (!res?.ok) {
        const msg = res.reason === 'promote_first'
          ? tFallback('crew.promoteFirst', 'Promote another member to leader first. A crew needs one.')
          : res.reason === 'active_war'
            ? tFallback('crew.leaveWar', 'Your crew is in a war. You can leave once it resolves.')
            : res.reason === 'not_deployed'
              ? tFallback('crew.leaveSoon', 'Leaving isn\'t available yet.')
              : tFallback('crew.leaveFailed', 'Could not leave the crew.');
        toast.error(msg);
        return;
      }
      toast.success(res.crewDeleted
        ? tFallback('crew.leftAndDeleted', 'You left. The crew was empty, so it\'s gone.')
        : tFallback('crew.left', 'You left the crew.'));
      qc.invalidateQueries({ queryKey: ['myCrews'] });
      onBack?.();
    },
    onError: () => toast.error(tFallback('crew.leaveFailed', 'Could not leave the crew.')),
  });

  if (!crew) return null;

  const myMember   = members.find(m => m.user_id === user?.id);
  const myRole     = myMember?.role ?? (crew.is_admin ? 'leader' : 'member');
  const isLeader   = myRole === 'leader' || !!crew.is_admin;
  // Editing the crew profile gates on is_admin, NOT on the 'leader' string,
  // because that is the column `is_crew_admin` reads and therefore the one
  // the crews_update policy enforces. They agree on every row in production
  // (5 leader/true, 1 member/false), but showing a control the server would
  // refuse is a silent no-op rather than a refusal the user can act on.
  const canEditCrew = !!(myMember?.is_admin ?? crew.is_admin);
  // The numeric form of the same thing. Ordering is what "may I act on
  // them" needs, and comparing 'moderator' to 'member' as strings sorts
  // alphabetically. See src/lib/crewPermissions.js.
  const myRank     = rankOf(myMember ?? { role: myRole, is_admin: crew.is_admin });
  const leader     = members.find(m => (m.role ?? (m.is_admin ? 'leader' : 'member')) === 'leader');
  const leaderName = leader?.username || leader?.profile?.username || null;
  const placing    = placingFor(standings, crewId);
  const { pct: levelPct } = crewLevelProgress(crew);
  const capacity   = treasury?.maxCapacity ?? crew.max_capacity ?? 16;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.15 }}
      className="flex flex-col h-full min-h-0"
    >
      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="shrink-0">
        <div className="relative h-24 overflow-hidden">
          {crew.avatar_url ? (
            <img
              loading="lazy"
              src={crew.avatar_url}
              alt=""
              className="w-full h-full object-cover"
              draggable={false}
            />
          ) : (
            <div
              className="w-full h-full"
              style={{ background: 'linear-gradient(122deg, hsl(var(--primary) / 0.55), hsl(var(--primary) / 0.15))' }}
            />
          )}
          {/* Scrim so the back control stays legible on any banner. */}
          <div
            className="absolute inset-0"
            style={{ background: 'linear-gradient(to top, hsl(var(--background)), transparent 62%)' }}
          />
          <button
            onClick={onBack}
            className="absolute top-3 start-3 w-8 h-8 rounded-full bg-background/70 backdrop-blur flex items-center justify-center"
            aria-label={tFallback('crew.back', 'Back')}
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          {canEditCrew && (
            <button
              onClick={() => setSettingsOpen(true)}
              className="absolute top-3 end-3 w-8 h-8 rounded-full bg-background/70 backdrop-blur flex items-center justify-center"
              aria-label={tFallback('crew.settings', 'Crew settings')}
            >
              <Settings className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Crest punched over the seam. The ring is the page background,
            not a border colour — that's what makes it read as cut out of
            the banner rather than placed on it.

            h-8 AND flex, where this used to be h-0. Both are load-bearing and
            the second one is the subtle half.

            The crest is 64px with -mt-8, so exactly half of it (32px) hangs
            below the seam. At h-0 the container reserved no space for that
            half, so the title and the "Led by … · N of 16" byline began at the
            seam and the crest painted over their first 64px — z-10 put it on
            top. Measured at 390px: crest y 64→128 against a title at y 72→97
            and a byline at y 99→115. 56px of vertical overlap, which is why
            the header read as "…in Grind" and "…ed by sean".

            h-8 alone does NOT fix it. The container has no top padding or
            border, so the child's negative margin COLLAPSES through it and
            drags the container up by 32px — the box still contributes nothing
            to the flow and 24px of overlap survives. `flex` is what stops
            that: a flex item's margins never collapse with its container.
            Re-measured after: 0px overlap, crest bottom and container bottom
            both at 128. */}
        <div className="px-4 h-8 relative z-10 flex">
          <div
            className="w-16 h-16 rounded-2xl -mt-8 flex items-center justify-center overflow-hidden"
            style={{
              border: '3px solid hsl(var(--background))',
              background: 'hsl(var(--primary) / 0.15)',
            }}
          >
            {crew.avatar_url
              ? <img loading="lazy" src={crew.avatar_url} alt="" className="w-full h-full object-cover" draggable={false} />
              : <Shield className="w-7 h-7" style={{ color: 'hsl(var(--primary))' }} />}
          </div>
        </div>

        <div className="px-4 pt-2">
          <h2 className="font-heading font-bold text-xl leading-tight truncate">
            {crew.name}
            {crew.tag && (
              <span className="text-muted-foreground tracking-widest ms-2">{crew.tag}</span>
            )}
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {leaderName
              ? <>{tFallback('crew.ledBy', 'Led by')} {leaderName} · </>
              : null}
            {fmt(members.length)} {tFallback('crew.of', 'of')} {fmt(capacity)}
          </p>

          {/* Rendered only when there is one. An empty description must not
              leave a reserved blank line — see CLAUDE.md on sections with no
              data. Until the settings sheet shipped nothing could write this
              column, so every crew in production takes the null branch. */}
          {crew.description && (
            <p className="text-sm mt-2 whitespace-pre-line">{crew.description}</p>
          )}

          {/* One metric row. Text, not tiles. */}
          <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-sm text-muted-foreground">
            {Number.isFinite(Number(crew.crew_level)) && (
              <span><b className="text-foreground font-bold">Lvl {crew.crew_level}</b></span>
            )}
            {placing && standings?.division != null && (
              <span>
                <b className="text-foreground font-bold tabular-nums">{ordinal(placing)}</b>
                {' '}{tFallback('crew.inDivision', 'in Division')} {standings.division}
              </span>
            )}
            {Number.isFinite(Number(crew.wars_won)) && (
              <span className="tabular-nums">
                <b className="text-foreground font-bold">{crew.wars_won}</b>–
                <b className="text-foreground font-bold">{crew.wars_lost ?? 0}</b>
              </span>
            )}
            {treasury && (
              <span>
                <b className="text-foreground font-bold tabular-nums">{fmt(treasury.balance)}</b>
                {' '}{tFallback('crew.coins', 'coins')}
              </span>
            )}
          </div>

          {levelPct != null && (
            <div className="mt-2 h-[3px] rounded-full bg-secondary overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{ width: `${Math.round(levelPct * 100)}%`, background: 'hsl(var(--primary))' }}
              />
            </div>
          )}
        </div>

        <CrewSettingsSheet
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          crew={crew}
        />

        <CrewInviteSheet
          open={inviteOpen}
          onClose={() => setInviteOpen(false)}
          crewId={crewId}
          crewName={crew.name}
          members={members}
          maxCapacity={capacity}
        />

        {/* ── Tabs ─────────────────────────────────────────────────── */}
        <div className="flex gap-5 px-4 pt-4 border-b border-border">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`text-sm font-semibold pb-2.5 transition-colors ${
                tab === t.key
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground active:text-foreground'
              }`}
              style={tab === t.key
                ? { boxShadow: 'inset 0 -2px 0 hsl(var(--primary))' }
                : undefined}
              aria-current={tab === t.key ? 'page' : undefined}
            >
              {tFallback(`crew.tab.${t.key}`, t.label)}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <AnimatePresence mode="wait">
          {tab === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full overflow-y-auto px-4 py-4"
            >
              {/* War first: all three states with the action inline. A crew
                  at war shouldn't have to go looking for its war. */}
              <CrewBattleEntry crew={crew} currentUserId={user?.id} myRank={myRank} />
              <CrewChallengeCard crewId={crewId} isAdmin={isLeader} />
            </motion.div>
          )}

          {tab === 'roster' && (
            <motion.div
              key="roster"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full min-h-0"
            >
              <div className="h-full min-h-0 flex flex-col">
                {/* Gated on the CAPABILITY, not on is_admin — invite_to_crew
                    accepts `is_admin OR role IN ('leader','moderator')`, so a
                    moderator qualifies here where they do not for crew
                    settings. Offering a control the server refuses returns
                    42501 into a toast, which reads as a broken button. */}
                {can(myRank, 'INVITE_MEMBER') && (
                  <div className="shrink-0 px-4 pt-3">
                    <button
                      onClick={() => setInviteOpen(true)}
                      className="w-full h-10 rounded-xl bg-secondary text-foreground font-heading font-bold text-sm flex items-center justify-center gap-2"
                    >
                      <UserPlus className="w-4 h-4" aria-hidden="true" />
                      {tFallback('crewInvite.cta', 'Invite friends')}
                    </button>
                  </div>
                )}
                <div className="flex-1 min-h-0">
                  <CrewMemberDirectory
                    crewId={crewId}
                    members={members}
                    currentUserId={user?.id}
                    isCurrentAdmin={isLeader}
                    maxCapacity={capacity}
                    inline
                    onViewProfile={onViewProfile}
                  />
                </div>

                {/* Bottom of the roster, styled quiet: leaving is a real
                    action but not one to invite by accident. */}
                <div className="shrink-0 px-4 py-3 border-t border-border">
                  <button
                    onClick={() => {
                      const solo = members.length <= 1;
                      const warn = solo
                        ? `Leave ${crew.name}? You're the last member, so the crew will be deleted.`
                        : `Leave ${crew.name}?`;
                      if (!window.confirm(warn)) return;
                      leaveMut.mutate();
                    }}
                    disabled={leaveMut.isPending}
                    className="text-sm font-semibold text-destructive disabled:opacity-50"
                  >
                    {leaveMut.isPending
                      ? tFallback('crew.leaving', 'Leaving…')
                      : tFallback('crew.leave', 'Leave crew')}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {tab === 'chat' && (
            <motion.div
              key="chat"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full min-h-0"
            >
              <ChatViewportFrame>
                <CrewChat
                  crew={crew}
                  embedded
                  onBack={onBack}
                  onViewProfile={onViewProfile}
                />
              </ChatViewportFrame>
            </motion.div>
          )}

          {tab === 'league' && (
            <motion.div
              key="league"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full overflow-y-auto px-4 py-4"
            >
              <CrewLeaguePanel crewId={crewId} crewName={crew.name} />
            </motion.div>
          )}

          {tab === 'trophies' && (
            <motion.div
              key="trophies"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="h-full overflow-y-auto px-4 py-4"
            >
              <CrewTrophiesPanel crewId={crewId} myRank={myRank} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
