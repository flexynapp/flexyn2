// src/components/gymRival/GymRivalCard.jsx
// Workout-page Gym Rival entry card. States: no match → "Find Your Rival"
// (a human rival, or Past You); pending → "confirm / waiting" chip; active →
// matchup chip; void (this week) → "roll resets in …" chip. Human matches
// open GymRivalMenu, a Past You race opens PastYouSheet.
//
// Guests do not compete (Kegan, 2026-09-27): every start button routes a
// guest to ConnectAccountSheet instead, and the server refuses them anyway.

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { AnimatePresence } from 'framer-motion';
import { Target, Loader2, ChevronRight, AlertTriangle, Trophy, Swords, Dumbbell, Footprints, Ghost, Users } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { getMyGymRival, getRivalProfile, rollGymRival, declineGymRival, isThisWeek, getGymRivalWeekState, rivalMetric } from '@/lib/data/gymRival';
import { getCrewBadges } from '@/lib/data/crews';
import { reportError } from '@/lib/reportError';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { useWeightUnit } from '@/lib/WeightUnitContext';
import { formatWeight } from '@/lib/weightUnit';
import { useDistanceUnit } from '@/lib/DistanceUnitContext';
import { formatDistance } from '@/lib/distanceUnit';
import CreateDuelModal from '@/components/duels/CreateDuelModal';
import GymRivalMenu from '@/components/gymRival/GymRivalMenu';
import PastYouSheet from '@/components/gymRival/PastYouSheet';
import RivalMonthStrip from '@/components/gymRival/RivalMonthStrip';
import ConnectAccountSheet from '@/components/auth/ConnectAccountSheet';
import { getMyPastYou, startPastYou } from '@/lib/data/pastYou';
import { isGuestAccount } from '@/lib/guestIdentity';

export default function GymRivalCard({ currentUserId }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const { weightUnit } = useWeightUnit();
  const { distanceUnit } = useDistanceUnit();
  const qc = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showDuel, setShowDuel] = useState(false);
  const [mode, setMode] = useState('human'); // 'human' | 'ghost'
  const [connectOpen, setConnectOpen] = useState(false);
  const [pastYouOpen, setPastYouOpen] = useState(false);
  const isGuest = isGuestAccount(user);

  // /workout?rival=1 lands here from the Hub profile's contest rail —
  // Workout.jsx consumes the param and fires this once the page is up.
  // An event rather than a prop because this card is rendered deep inside
  // the start screen's tile switch, and the same hand-off shape is already
  // used for the Form Coach and the crews section.
  // It opens whatever is live: the human match, the Past You race, or nothing
  // (an empty menu rendered "@—" with a dead Challenge button).
  const openLiveRef = useRef(() => {});
  useEffect(() => {
    const handler = () => openLiveRef.current();
    window.addEventListener('flexyn:open-rival', handler);
    return () => window.removeEventListener('flexyn:open-rival', handler);
  }, []);

  const { data: assignment, isLoading } = useQuery({
    queryKey:  ['myGymRival', currentUserId],
    queryFn:   getMyGymRival,
    enabled:   !!currentUserId,
    staleTime: 60_000,
  });

  const { data: pastYou } = useQuery({
    queryKey:  ['myPastYou', currentUserId],
    queryFn:   getMyPastYou,
    enabled:   !!currentUserId,
    staleTime: 60_000,
  });

  const iAmInitiator = assignment ? assignment.user_id === currentUserId : true;
  const otherId = assignment ? (iAmInitiator ? assignment.rival_id : assignment.user_id) : null;
  const status = assignment?.status;
  const settledRecent = status === 'completed' && assignment?.settled_at
    && (Date.now() - new Date(assignment.settled_at).getTime() < 2 * 86400_000);
  // A void no longer locks anyone out until Monday (gym_rival_roll refuses
  // only while a match is pending or active), so it is a note on the Find
  // card, not a state of its own. No void timestamp exists; a void lands
  // 48h after acceptance, so ten days from assignment covers it.
  const recentVoid = status === 'void' && assignment?.assigned_at
    && (Date.now() - new Date(assignment.assigned_at).getTime() < 10 * 86400_000);
  const myResult = assignment?.winner_id ? (assignment.winner_id === currentUserId ? 'win' : 'loss') : 'draw';
  const liveHuman = status === 'pending' || status === 'active';
  const ghostLive = pastYou?.status === 'active';
  const ghostSettledAt = pastYou?.status === 'completed' && pastYou.settled_at ? new Date(pastYou.settled_at).getTime() : 0;
  const humanSettledAt = settledRecent ? new Date(assignment.settled_at).getTime() : 0;
  // What the card shows, in priority order: a live human match, a live Past
  // You race, then the more recent of the two results, then the Find card.
  // The server allows only one live rival, so the first two never collide.
  const view = liveHuman ? 'human'
    : ghostLive ? 'ghost'
    : humanSettledAt && humanSettledAt >= ghostSettledAt ? 'humanResult'
    : ghostSettledAt ? 'ghost'
    : 'find';
  const iConfirmed = assignment ? (iAmInitiator ? assignment.initiator_confirmed : assignment.rival_confirmed) : false;

  const { data: profile } = useQuery({
    queryKey:  ['gymRivalProfile', otherId],
    queryFn:   () => getRivalProfile(otherId),
    enabled:   !!otherId && status !== 'void',
    staleTime: 5 * 60_000,
  });

  // Crew identity for the rival — see getCrewBadges on why this is an RPC.
  const { data: crews } = useQuery({
    queryKey:  ['crewBadges', currentUserId, otherId],
    queryFn:   () => getCrewBadges([currentUserId, otherId]),
    enabled:   !!currentUserId && !!otherId,
    staleTime: 5 * 60_000,
  });

  // The gap is what makes this card worth tapping — "Level 1" is not news.
  // Same query key as the menu, so opening it costs nothing extra.
  const { data: week } = useQuery({
    queryKey:  ['gymRivalWeek', assignment?.id],
    queryFn:   () => getGymRivalWeekState(assignment.id),
    enabled:   !!assignment?.id && status === 'active',
    staleTime: 60_000,
  });
  // An active row never accepted by both sides can never settle — see the
  // stalled branch in GymRivalMenu and migration 363.
  const isStalled = status === 'active'
    && (week ? week.isStalled : (!assignment?.accepted_at && !isThisWeek(assignment?.assigned_at)));

  const startMut = useMutation({
    mutationFn: (type) => startPastYou(type),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['myPastYou'] });
      setMenuOpen(false);
      setPastYouOpen(true);
    },
    onError: (err) => {
      if (err?.reason === 'guest_account') { setConnectOpen(true); return; }
      if (err?.reason === 'rival_in_progress') {
        toast.info(tFallback('pastYou.finishHumanFirst', 'Finish your current rival match before racing Past You.'));
        return;
      }
      reportError(err, { feature: 'pastYou.start', level: 'warning', userEmail: user?.email });
      toast.error(tFallback('pastYou.startFailed', 'Could not start Past You. Try again.'));
    },
  });

  // Guests never reach the server with a start: they get the connect flyout.
  const asMember = (fn) => () => (isGuest ? setConnectOpen(true) : fn());

  // The sheet renders nothing without a match, so a race started on another
  // device (or a stale cache) made the tap do nothing. Fetch, then open.
  const openPastYou = async () => {
    await qc.fetchQuery({ queryKey: ['myPastYou', currentUserId], queryFn: getMyPastYou, staleTime: 0 }).catch(() => null);
    setPastYouOpen(true);
  };

  const rollMut = useMutation({
    mutationFn: (type) => rollGymRival(type),
    onSuccess: async (row, type) => {
      if (!row) {
        // The roll clears a stuck match server-side even when it finds
        // nobody, so refetch before saying so, or the stalled card stays up
        // until the query goes stale.
        setMenuOpen(false);
        qc.invalidateQueries({ queryKey: ['myGymRival'] });
        toast.info(tFallback('gymRivalCard.noRivalsGhost', 'No human rivals are free right now. Race Past You instead.'), {
          action: { label: tFallback('pastYou.race', 'Race Past You'), onClick: () => startMut.mutate(type) },
        });
        return;
      }
      await qc.invalidateQueries({ queryKey: ['myGymRival'] });
      qc.invalidateQueries({ queryKey: ['gymRivalProfile'] });
      qc.invalidateQueries({ queryKey: ['gymRivalStats'] });
      setMenuOpen(true); // reveal + confirm
    },
    onError: (err) => {
      if (err?.reason === 'guest_account') { setConnectOpen(true); return; }
      if (err?.reason === 'past_you_in_progress') { openPastYou(); return; }
      reportError(err, { feature: 'gymRival.roll', level: 'warning', userEmail: user?.email });
      toast.error(tFallback('gymRivalCard.findFailed', 'Could not find a Gym Rival. Try again.'));
    },
  });

  const declineMut = useMutation({
    mutationFn: () => declineGymRival(assignment.id),
    onSuccess: () => {
      setMenuOpen(false);
      qc.invalidateQueries({ queryKey: ['myGymRival'] });
      toast.success(tFallback('gymRivalCard.declined', 'Challenge declined.'));
    },
    onError: () => toast.error(tFallback('gymRivalCard.declineFailed', 'Could not decline. Try again.')),
  });

  const name  = profile?.username;

  openLiveRef.current = () => {
    if (view === 'ghost') openPastYou();
    else if (view === 'human' || view === 'humanResult') setMenuOpen(true);
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 mb-4 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-secondary shrink-0" />
          <div className="flex-1 space-y-2"><div className="h-3 w-32 rounded bg-secondary" /><div className="h-2.5 w-20 rounded bg-secondary" /></div>
        </div>
      </div>
    );
  }

  const menu = (
    <>
      {!isGuest && <RivalMonthStrip currentUserId={currentUserId} />}
      <GymRivalMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        assignment={assignment}
        currentUserId={currentUserId}
        onReroll={() => rollMut.mutate(assignment?.rival_type || 'gym')}
        rerolling={rollMut.isPending}
        onDecline={() => declineMut.mutate()}
        declining={declineMut.isPending}
        onChallenge={() => { setMenuOpen(false); setShowDuel(true); }}
      />
      <AnimatePresence>
        {showDuel && otherId && (
          <CreateDuelModal opponentId={otherId} opponentUsername={name} onClose={() => setShowDuel(false)} onCreated={() => setShowDuel(false)} />
        )}
      </AnimatePresence>
      <PastYouSheet open={pastYouOpen} onClose={() => setPastYouOpen(false)} match={pastYou} />
      <ConnectAccountSheet open={connectOpen} onClose={() => setConnectOpen(false)} returnPath="/workout" />
    </>
  );

  // ── Racing Past You (or just finished) ──────────────────────────────────
  if (view === 'ghost') {
    const settledGhost = pastYou.status === 'completed';
    const ghostType = pastYou.rival_type === 'cardio'
      ? tFallback('gymRivalCard.cardioRival', 'Cardio Rival')
      : tFallback('gymRivalCard.gymRival', 'Gym Rival');
    return (
      <>
        <motion.button type="button" onClick={openPastYou} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.99 }}
          className={`w-full rounded-2xl border p-4 mb-4 flex items-center gap-3 text-start transition-colors ${settledGhost && pastYou.won ? 'border-success/25 bg-success/5' : 'border-primary/20 bg-primary/5'}`}>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${settledGhost && pastYou.won ? 'bg-success/10' : 'bg-primary/10'}`}>
            {settledGhost && pastYou.won ? <Trophy className="w-6 h-6 text-success" /> : <Ghost className="w-6 h-6 text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <span className={`text-micro font-black uppercase tracking-wider ${settledGhost && pastYou.won ? 'text-success' : 'text-primary'}`}>
              {settledGhost ? tFallback('gymRivalCard.lastWeekSResult', "Last week's result") : ghostType}
            </span>
            <p className="text-base font-black truncate mt-0.5">
              {settledGhost
                ? (pastYou.won ? tFallback('pastYou.youWon', 'You beat Past You') : tFallback('pastYou.youLost', 'Past You held on'))
                : tFallback('pastYou.vsLevel', 'Past You, Lv. {n}', { n: String(pastYou.level) })}
            </p>
            <p className="text-xs text-muted-foreground truncate">
              {settledGhost
                ? tFallback('pastYou.tapForResult', 'Tap to see the result')
                : tFallback('pastYou.tapForRace', 'Tap to see the race')}
            </p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        </motion.button>
        {settledGhost && (
          <div className="flex gap-2 -mt-2 mb-4">
            <button onClick={asMember(() => rollMut.mutate(pastYou.rival_type))} disabled={rollMut.isPending || startMut.isPending}
              className="flex-1 py-2.5 rounded-xl border border-border text-xs font-bold disabled:opacity-50">
              {tFallback('pastYou.findHuman', 'Find a human rival')}
            </button>
            <button onClick={asMember(() => startMut.mutate(pastYou.rival_type))} disabled={rollMut.isPending || startMut.isPending}
              className="flex-1 py-2.5 rounded-xl border border-border text-xs font-bold disabled:opacity-50">
              {tFallback('pastYou.raceAgain', 'Race Past You again')}
            </button>
          </div>
        )}
        {menu}
      </>
    );
  }

  // ── No active match → prompt to find one ────────────────────────────────
  if (view === 'find') {
    const ghostMode = mode === 'ghost';
    const busy = rollMut.isPending || startMut.isPending;
    const go = (type) => asMember(() => (ghostMode ? startMut.mutate(type) : rollMut.mutate(type)));
    return (
      <>
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border border-border bg-card p-5 mb-4 text-center">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-3">
            {ghostMode ? <Ghost className="w-5 h-5 text-primary" /> : <Target className="w-5 h-5 text-primary" />}
          </div>
          <p className="text-sm font-bold mb-1">{tFallback('gymRival.findTitle', 'Find Your Rival')}</p>
          {recentVoid && (
            <p className="text-xs text-muted-foreground mb-2 inline-flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 text-primary shrink-0" />
              {tFallback('gymRivalCard.voidedNote', 'Your last match was voided because neither of you logged.')}
            </p>
          )}

          {/* Who you race: a person around your level, or Past You. */}
          <div role="radiogroup" aria-label={tFallback('pastYou.opponent', 'Opponent')}
            className="flex gap-1 p-1 rounded-xl bg-secondary mb-2">
            {[['human', Users, tFallback('pastYou.modeHuman', 'Human rival')], ['ghost', Ghost, tFallback('pastYou.title', 'Past You')]].map(([key, Icon, label]) => (
              <button key={key} type="button" role="radio" aria-checked={mode === key} onClick={() => setMode(key)}
                className={`flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-colors ${mode === key ? 'bg-card text-foreground shadow-md' : 'text-muted-foreground'}`}>
                <Icon className="w-3.5 h-3.5" /> {label}
              </button>
            ))}
          </div>

          <p className="text-xs text-muted-foreground mb-4">
            {ghostMode
              ? tFallback('pastYou.findDesc', 'Race a ghost of your own recent weeks. It gets stronger as you set PRs, so the only way to win is to beat who you were.')
              : tFallback('gymRival.findDesc', 'Pick a challenge type and we\'ll match you with someone around your level for the week. Out-train them to win.')}
          </p>
          <div className="flex gap-2">
            <button onClick={go('gym')} disabled={busy}
              className="flex-1 inline-flex flex-col items-center gap-1 px-3 py-3 rounded-xl border border-border bg-card text-foreground text-sm font-bold hover:bg-secondary active:bg-secondary disabled:opacity-50 transition-colors">
              <Dumbbell className="w-4 h-4 text-primary" />
              {tFallback("gymRivalCard.gymRival", "Gym Rival")}
              <span className="text-micro font-medium text-muted-foreground">{tFallback("bodyMap.mode.volume", "Volume")}</span>
            </button>
            <button onClick={go('cardio')} disabled={busy}
              className="flex-1 inline-flex flex-col items-center gap-1 px-3 py-3 rounded-xl border border-border bg-card text-foreground text-sm font-bold hover:bg-secondary active:bg-secondary disabled:opacity-50 transition-colors">
              <Footprints className="w-4 h-4 text-primary" />
              {tFallback("gymRivalCard.cardioRival", "Cardio Rival")}
              <span className="text-micro font-medium text-muted-foreground">{tFallback("cardio.field.distance", "Distance")}</span>
            </button>
          </div>
          {isGuest && (
            <button type="button" onClick={() => setConnectOpen(true)} className="mt-3 text-xs font-bold text-primary underline underline-offset-2">
              {tFallback('connectAccount.guestNote', 'Guest accounts can\'t compete. Connect an account')}
            </button>
          )}
          {busy && (
            <p className="mt-3 text-xs text-muted-foreground inline-flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {tFallback('gymRival.searching', 'Searching…')}</p>
          )}
        </motion.div>
        {menu}
      </>
    );
  }

  // ── Completed this week → result chip ───────────────────────────────────
  if (view === 'humanResult') {
    const win = myResult === 'win';
    const draw = myResult === 'draw';
    return (
      <>
        <motion.button type="button" onClick={() => setMenuOpen(true)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className={`w-full rounded-2xl border p-4 mb-4 flex items-center gap-3 text-start transition-colors ${win ? 'border-success/25 bg-success/5 hover:bg-success/10' : 'border-border bg-secondary/30 hover:bg-secondary/50 active:bg-secondary/50'}`}>
          <div className={`w-12 h-12 rounded-full flex items-center justify-center shrink-0 ${win ? 'bg-success/10' : draw ? 'bg-secondary' : 'bg-primary/10'}`}>
            {win ? <Trophy className="w-6 h-6 text-success" /> : draw ? <Target className="w-6 h-6 text-muted-foreground" /> : <Swords className="w-6 h-6 text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <span className={`text-micro font-black uppercase tracking-wider ${win ? 'text-success' : 'text-muted-foreground'}`}>{tFallback("gymRivalCard.lastWeekSResult", "Last week's result")}</span>
            <p className="text-sm font-bold mt-0.5">{win ? tFallback('gymRivalCard.youWon', 'You won')
              : draw ? tFallback('gymRivalCard.draw', 'It was a draw')
              : tFallback('gymRivalCard.theyWon', '@{n} won', { n: name || '—' })}</p>
            <p className="text-xs text-muted-foreground">{tFallback('gymRivalCard.tapForResultRoll', 'Tap to see the result and roll again')}</p>
          </div>
          <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
        </motion.button>
        {menu}
      </>
    );
  }

  // ── Pending / active → matchup chip ─────────────────────────────────────
  const rivalCrew = otherId ? (crews?.[otherId] || null) : null;
  const isCardio = assignment?.rival_type === 'cardio';
  const typeLabel = isCardio
    ? tFallback('gymRivalCard.cardioRival', 'Cardio Rival')
    : tFallback('gymRivalCard.gymRival', 'Gym Rival');
  const needsMyConfirm = status === 'pending' && !iConfirmed;
  const waiting = status === 'pending' && iConfirmed;
  const label = isStalled ? tFallback('gymRivalCard.stalledKicker', "This match can't finish")
    : needsMyConfirm ? tFallback('gymRivalCard.confirmYour', 'Confirm your {t}', { t: typeLabel })
    : waiting ? tFallback('gymRivalCard.waitingKicker', 'Waiting for them to accept')
    : typeLabel;

  // The subtitle carries the state of play, in the metric's own units.
  const metric = rivalMetric(week, assignment?.rival_type || 'gym');
  const metricText = (v) => (isCardio
    ? formatDistance(v || 0, distanceUnit, v >= 1000 ? 1 : 2)
    : formatWeight(v || 0, weightUnit));
  const gap = metric ? metric.you - metric.them : null;
  const activeSub = isStalled
    ? tFallback('gymRivalCard.stalledSub', 'Never accepted. Tap to clear it')
    : gap == null
      ? tFallback('gymRivalCard.tapForMatchup', 'Tap to see the matchup')
      : gap > 0
        ? tFallback('gymRivalMenu.youLeadBy', 'You lead by {v}', { v: metricText(Math.abs(gap)) })
        : gap < 0
          ? tFallback('gymRivalMenu.youTrailBy', "You're {v} behind", { v: metricText(Math.abs(gap)) })
          : tFallback('gymRivalCard.levelSoFar', 'Level so far. Tap to see');

  return (
    <>
      <motion.button type="button" onClick={() => setMenuOpen(true)} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} whileTap={{ scale: 0.99 }}
        className={`w-full rounded-2xl border p-4 mb-4 flex items-center gap-3 text-start transition-colors ${needsMyConfirm ? 'border-primary/50 bg-primary/10 hover:bg-primary/10' : 'border-primary/20 bg-primary/5 hover:bg-primary/5 active:bg-primary/5'}`}>
        {profile?.avatar_url ? (
          <img loading="lazy" src={profile.avatar_url} className="w-12 h-12 rounded-full object-cover shrink-0 ring-2 ring-primary/30" alt={name} />
        ) : (
          <div className="w-12 h-12 rounded-full bg-primary/20 ring-2 ring-primary/30 flex items-center justify-center shrink-0">
            <span className="text-lg font-black text-primary">{name?.[0]?.toUpperCase() || '?'}</span>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <Target className="w-3 h-3 text-primary" />
            <span className="text-micro font-black uppercase tracking-wider text-primary">{label}</span>
          </div>
          <p className="text-base font-black truncate mt-0.5">@{name || '—'}</p>
          {rivalCrew?.name && (
            <p className="text-micro text-muted-foreground truncate">
              {rivalCrew.tag ? `${rivalCrew.name} · [${rivalCrew.tag}]` : rivalCrew.name}
            </p>
          )}
          <p className="text-xs text-muted-foreground truncate">
            {needsMyConfirm ? tFallback('gymRivalCard.tapToAccept', 'Tap to accept the challenge')
              : waiting ? tFallback('gymRivalCard.theyHaventAccepted', "They haven't accepted yet")
              : activeSub}
          </p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </motion.button>
      {menu}
    </>
  );
}
