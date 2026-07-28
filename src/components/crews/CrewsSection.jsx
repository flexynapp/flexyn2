// src/components/crews/CrewsSection.jsx
//
// Main Crews entry point rendered inside Hub when feedTab === 'crews'.
// States: empty (no crews) → crew list → crew page → creation flow → discovery
// Tabs: "My Crews" | "Discover" | "Battles"

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Plus, ChevronRight, Loader2, Swords, Globe2 } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/AuthContext';
import * as crewsData from '@/lib/data/crews';
import { useNumberFormatter } from '@/lib/intl';
import CrewLeaguePanel from '@/components/crews/CrewLeaguePanel';
import { crewLevelProgress } from '@/lib/data/crewSeasons';
import CrewPage from './CrewPage';
import CrewBattleEntry from './CrewBattleEntry';
import CrewCreationFlow from './CrewCreationFlow';
import CrewMemberDots from './CrewMemberDots';
import CrewSuggestionRail from './CrewSuggestionRail';
import CrewDiscovery from './CrewDiscovery';
import ChatViewportFrame from '@/components/ChatViewportFrame';

// ── Crew list card ────────────────────────────────────────────────────────────

function CrewCard({ crew, onClick, currentUserId }) {
  const fmt = useNumberFormatter();
  const { data: members = [] } = useQuery({
    queryKey: ['crewMembers', crew.id],
    queryFn:  () => crewsData.getCrewMembers(crew.id),
    staleTime: 30_000,
  });

  const { pct: levelPct } = crewLevelProgress(crew);
  const myMember = members.find(m => m.user_id === currentUserId);
  const myRole = crew.is_admin ? 'leader'
    : (myMember?.role === 'moderator' ? 'moderator' : 'member');

  // Same shape as the Crew page header, one step down the type scale:
  // crest, name, "who leads it · how full", then one metric row. The list
  // row and the page it opens should read as the same object.
  const leader = members.find(
    m => (m.role ?? (m.is_admin ? 'leader' : 'member')) === 'leader'
  );
  const leaderName = leader?.username || null;
  const capacity   = crew.max_capacity ?? 16;

  // Role used to be two coloured pills. They were the last chips in the
  // area, and a pill for something the sentence can just say is exactly the
  // chrome docs/profile-ui-premium-research.md counts against us — so the
  // viewer's own standing is stated in the line instead.
  const standing = myRole === 'leader'    ? 'You lead'
                 : myRole === 'moderator' ? 'You moderate'
                 : leaderName             ? `Led by ${leaderName}`
                 : null;

  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="w-full flex items-center gap-3 p-4 rounded-2xl bg-card text-start"
    >
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 overflow-hidden"
        style={{ background: 'hsl(var(--primary) / 0.15)' }}
      >
        {crew.avatar_url
          ? <img loading="lazy" src={crew.avatar_url} alt="" className="w-full h-full object-cover" draggable={false} />
          : <Shield className="w-6 h-6" style={{ color: 'hsl(var(--primary))' }} />}
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-heading font-bold text-base text-foreground truncate leading-tight">
          {crew.name}
        </p>

        {/* Identity line. No Users icon: the profile research counts a
            decorative icon beside a count as the tile idiom in miniature. */}
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {standing ? <>{standing} · </> : null}
          {fmt(members.length)} of {fmt(capacity)}
        </p>

        {/* Crew progression (migration 248) as text, hierarchy from weight
            and colour. Absent on a pre-248 host, in which case the line
            simply doesn't render. */}
        {Number.isFinite(Number(crew.crew_level)) && (
          <p className="text-xs text-muted-foreground mt-1">
            <span className="font-bold text-foreground">Lvl {crew.crew_level}</span>
            {Number.isFinite(Number(crew.trophies)) && (
              <> · <span className="font-bold text-foreground tabular-nums">{fmt(crew.trophies)}</span> trophies</>
            )}
            {Number.isFinite(Number(crew.wars_won)) && (
              <> · <span className="font-bold text-foreground tabular-nums">{crew.wars_won}</span>–<span className="font-bold text-foreground tabular-nums">{crew.wars_lost ?? 0}</span></>
            )}
          </p>
        )}

        {levelPct != null && (
          <div className="mt-1.5 h-[3px] rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.round(levelPct * 100)}%`, background: 'hsl(var(--primary))' }}
            />
          </div>
        )}

        {/* Overlapping avatar dots — humanizes the group. Reading "5
            members" doesn't convey community the way 5 little faces do. */}
        {members.length > 0 && (
          <div className="mt-2">
            <CrewMemberDots members={members} size={20} max={5} />
          </div>
        )}
      </div>

      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </motion.button>
  );
}

// ── Battles tab ───────────────────────────────────────────────────────────────
//
// CrewBattleEntry moved to its own file so the Crew page can render the same
// three war states without importing back from this module. See
// CrewBattleEntry.jsx for why that direction matters.


function BattlesView({ myCrews, currentUserId }) {
  if (myCrews.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center py-20 px-8 text-center"
      >
        <div className="w-16 h-16 rounded-3xl bg-rose-500/10 flex items-center justify-center mb-4">
          <Swords className="w-8 h-8 text-rose-500" />
        </div>
        <p className="font-heading font-bold text-lg mb-2">No Crews Yet</p>
        <p className="text-sm text-muted-foreground">
          Join or create a crew first, then challenge rival crews to weekly XP battles.
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="pt-2 lg:pb-6"
    >
      <p className="text-xs text-muted-foreground mb-4 leading-relaxed">
        Each crew can enter one battle at a time. The crew that earns the most XP in 7 days wins.
      </p>
      {myCrews.map(crew => (
        <React.Fragment key={crew.id}>
          {/* Standings first, then the war entry — where you stand is the
              context that makes "enter battle" mean something. Self-hides
              until migration 248 seats the crew in a division. */}
          <CrewLeaguePanel crewId={crew.id} crewName={crew.name} />
          <CrewBattleEntry crew={crew} currentUserId={currentUserId} />
        </React.Fragment>
      ))}
    </motion.div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function CrewsSection({ initialCrewId }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeCrew,  setActiveCrew]  = useState(null);
  const [creating,    setCreating]    = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [warTab,      setWarTab]      = useState('crews'); // 'crews' | 'discover' | 'battles'

  const { data: myCrews = [], isLoading } = useQuery({
    queryKey: ['myCrews', user?.id],
    queryFn:  () => crewsData.getMyCrews(user.id),
    enabled:  !!user?.id,
    staleTime: 15_000,
    onSuccess: (crews) => {
      if (initialCrewId && !activeCrew) {
        const target = crews.find(c => c.id === initialCrewId);
        if (target) setActiveCrew(target);
      }
    },
  });

  const handleCreated = (crew) => {
    setCreating(false);
    qc.invalidateQueries({ queryKey: ['myCrews', user?.id] });
    setActiveCrew({ ...crew, is_admin: true });
  };

  React.useEffect(() => {
    const handler = (e) => {
      const { crewId } = e.detail || {};
      if (!crewId) return;
      const found = myCrews.find(c => c.id === crewId);
      if (found) setActiveCrew(found);
    };
    window.addEventListener('flexyn:open-crew', handler);
    return () => window.removeEventListener('flexyn:open-crew', handler);
  }, [myCrews]);

  // ── Crew chat view ────────────────────────────────────────────────────────────
  // Tapping a Crew opens the Crew PAGE, not the chat. Chat is a tab on it.
  // See docs/crew-page-research.md: both references open the group as a
  // subject, and everything 248-251 added to a Crew was invisible while the
  // destination was a message thread.
  if (activeCrew) {
    return (
      <CrewPage
        crew={activeCrew}
        onBack={() => setActiveCrew(null)}
      />
    );
  }

  // ── Creation flow ─────────────────────────────────────────────────────────────
  if (creating) {
    return (
      <ChatViewportFrame>
        <CrewCreationFlow onCreated={handleCreated} onClose={() => setCreating(false)} />
      </ChatViewportFrame>
    );
  }

  // ── Discovery ─────────────────────────────────────────────────────────────────
  if (discovering) {
    return (
      <ChatViewportFrame>
        <CrewDiscovery
          onBack={() => setDiscovering(false)}
          onJoined={() => {
            setDiscovering(false);
            qc.invalidateQueries({ queryKey: ['myCrews', user?.id] });
          }}
        />
      </ChatViewportFrame>
    );
  }

  // ── Loading ───────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── Empty state (no crews) ────────────────────────────────────────────────────
  if (myCrews.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25 }}
        className="flex flex-col items-center justify-center py-16 px-8 text-center"
      >
        <div
          className="w-20 h-20 rounded-3xl flex items-center justify-center mb-5"
          style={{ background: 'hsl(var(--primary) / 0.1)' }}
        >
          <Shield className="w-10 h-10" style={{ color: 'hsl(var(--primary))' }} />
        </div>
        <h3 className="font-heading font-bold text-xl mb-2">Your Crews</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mb-8">
          Create a private group with up to 16 friends. Share workouts, post roll calls, and fuel each other with XP.
        </p>
        <div className="flex gap-3">
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setDiscovering(true)}
            className="px-5 py-3 rounded-2xl font-bold text-sm flex items-center gap-2 border border-border text-foreground"
          >
            <Globe2 className="w-4 h-4" />
            Discover
          </motion.button>
          <motion.button
            whileTap={{ scale: 0.96 }}
            onClick={() => setCreating(true)}
            className="px-5 py-3 rounded-2xl font-bold text-white text-sm flex items-center gap-2"
            style={{ background: 'hsl(var(--primary))' }}
          >
            <Plus className="w-4 h-4" />
            Create a Crew
          </motion.button>
        </div>
      </motion.div>
    );
  }

  // ── Crews list + Discover + Battles tabs ──────────────────────────────────────
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      className="pt-2 lg:pb-6"
    >
      {/* Tab strip */}
      <div className="flex gap-1 p-1 bg-secondary rounded-xl mb-4">
        <button
          onClick={() => setWarTab('crews')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-lg transition-colors ${
            warTab === 'crews' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Shield className="w-3.5 h-3.5" />
          My Crews
        </button>
        <button
          onClick={() => setWarTab('discover')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-lg transition-colors ${
            warTab === 'discover' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Globe2 className="w-3.5 h-3.5" />
          Discover
        </button>
        <button
          onClick={() => setWarTab('battles')}
          className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-sm font-semibold rounded-lg transition-colors ${
            warTab === 'battles' ? 'bg-rose-500 text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <Swords className="w-3.5 h-3.5" />
          Battles
        </button>
      </div>

      <AnimatePresence mode="wait">
        {warTab === 'crews' && (
          <motion.div
            key="crews"
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -8 }}
            transition={{ duration: 0.15 }}
          >
            {/* Suggested crews rail — surfaces popular non-full crews
                the user isn't yet in. Self-hides when no suggestions
                are available or when the user dismissed it. Activates
                the crew_war notification surface for users who'd
                otherwise never join a crew. */}
            <CrewSuggestionRail />

            <div className="flex items-center justify-between mb-4">
              <h3 className="font-heading font-bold text-base">My Crews</h3>
              {/* One crew per user (migration 252) — createCrew is refused
                  server-side, so offering the button would only produce a
                  toast. My Crews only renders when you have one, so this is
                  effectively always hidden; it stays for the grandfathered
                  multi-crew accounts that predate the rule. */}
              {myCrews.length === 0 && (
                <motion.button
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setCreating(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold text-white"
                  style={{ background: 'hsl(var(--primary))' }}
                >
                  <Plus className="w-3.5 h-3.5" />
                  New
                </motion.button>
              )}
            </div>
            <div className="space-y-2.5">
              {myCrews.map(crew => (
                <CrewCard key={crew.id} crew={crew} onClick={() => setActiveCrew(crew)} currentUserId={user?.id} />
              ))}
            </div>
          </motion.div>
        )}

        {warTab === 'discover' && (
          <motion.div
            key="discover"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.15 }}
          >
            {/* Inline discovery (for users already in crews) */}
            <CrewDiscovery
              onBack={() => setWarTab('crews')}
              onJoined={() => {
                qc.invalidateQueries({ queryKey: ['myCrews', user?.id] });
                setWarTab('crews');
              }}
            />
          </motion.div>
        )}

        {warTab === 'battles' && (
          <motion.div
            key="battles"
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.15 }}
          >
            <BattlesView myCrews={myCrews} currentUserId={user?.id} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
