// src/components/duels/CreateDuelModal.jsx
// Two-step challenge flow:
//   Step 1, pick: recent opponents and people you follow, or live search.
//   Step 2, configure: duel type and time window, then send.
//
// Search goes through duel_opponent_candidates (migration 20260927162000),
// not a client ilike on public_profiles. The view was returning only the
// viewer's own row, so search found no one; and even working, it would have
// listed guests (42 of 48 have a username) that the server refuses to duel.

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  X, Swords, Dumbbell, Timer, Loader2, Search, UserCircle2,
  ArrowLeft, SendHorizonal, Check, ChevronRight,
} from 'lucide-react';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  createDuel, getFrequentOpponents, sendDuelDM, duelErrorMessage, searchDuelOpponents,
} from '@/lib/data/duels';
import { useAuth } from '@/lib/AuthContext';
import { toast } from '@/lib/toast';
import { haptic } from '@/lib/haptic';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useLanguage } from '@/lib/LanguageContext';

// ── Duel type config ──────────────────────────────────────────────────────────
// Exercise Duel is gone from the picker: nothing ever let the challenger
// choose the exercise, so it scored "most reps in any set of anything". The
// server refuses it too (20260927161000_duels_lockdown). Mirror used violet,
// which the app reserves for rarity tiers.

const DUEL_TYPES = [
  { id: 'open',   label: 'Open Duel',   icon: Timer,    description: 'Train freely in the time window. Most total volume wins.' },
  { id: 'mirror', label: 'Mirror Duel', icon: Dumbbell, description: 'Opponent completes your exact session. Scored on completion % + volume.' },
];

const WINDOWS = [12, 24, 48, 72];

// Debounce a value so search runs when typing pauses, not on every key.
function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ profile }) {
  return profile.avatar_url ? (
    <img loading="lazy" src={profile.avatar_url} className="w-10 h-10 rounded-full object-cover shrink-0" alt="" />
  ) : (
    <div className="w-10 h-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
      <span className="text-sm font-black text-primary">{profile.username?.[0]?.toUpperCase()}</span>
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-2 py-2">
      <div className="w-10 h-10 rounded-full bg-secondary animate-pulse" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-28 rounded bg-secondary animate-pulse" />
        <div className="h-2.5 w-14 rounded bg-secondary animate-pulse" />
      </div>
    </div>
  );
}

// ── Opponent row ──────────────────────────────────────────────────────────────

function OpponentRow({ profile, stats, index, onSelect, onQuickSend, sending }) {
  const { tFallback } = useLanguage();
  const reduceMotion = useReducedMotion();
  const wins   = stats?.wins   ?? 0;
  const losses = stats?.losses ?? 0;
  const name   = profile.display_name || null;

  return (
    <motion.li
      layout={!reduceMotion}
      initial={reduceMotion ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reduceMotion ? undefined : { opacity: 0 }}
      transition={{ duration: 0.18, delay: reduceMotion ? 0 : Math.min(index, 8) * 0.025 }}
      className="flex items-center gap-1"
    >
      <motion.button
        type="button"
        whileTap={reduceMotion ? undefined : { scale: 0.98 }}
        onClick={() => { haptic('subtle'); onSelect(profile); }}
        className="flex items-center gap-3 flex-1 min-w-0 px-2 py-2 rounded-xl text-start hover:bg-secondary/60 active:bg-secondary transition-colors"
      >
        <Avatar profile={profile} />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">@{profile.username}</p>
          <p className="text-micro text-muted-foreground truncate">
            {[
              name,
              profile.current_level != null ? tFallback('createDuelModal.level', 'Lv {n}', { n: profile.current_level }) : null,
            ].filter(Boolean).join(' · ') || ' '}
          </p>
        </div>
        {(wins > 0 || losses > 0) && (
          <span className="text-micro font-bold tabular-nums shrink-0">
            <span className="text-success">{tFallback('createDuelModal.winsShort', '{n}W', { n: wins })}</span>
            <span className="text-muted-foreground"> · </span>
            <span className="text-destructive">{tFallback('createDuelModal.lossesShort', '{n}L', { n: losses })}</span>
          </span>
        )}
        <ChevronRight className="w-4 h-4 text-muted-foreground/60 shrink-0 rtl:scale-x-[-1]" />
      </motion.button>
      {/* Quick send: an Open duel with a 24h window, one tap. */}
      <motion.button
        type="button"
        whileTap={reduceMotion ? undefined : { scale: 0.9 }}
        onClick={() => onQuickSend(profile)}
        disabled={sending}
        className="w-11 h-11 flex items-center justify-center rounded-xl bg-rose-500/10 hover:bg-rose-500/20 active:bg-rose-500/20 text-rose-500 transition-colors shrink-0 disabled:opacity-50"
        aria-label={tFallback('createDuelModal.quickChallenge', 'Quick challenge @{handle}', { handle: profile.username })}
      >
        {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <SendHorizonal className="w-4 h-4 rtl:scale-x-[-1]" />}
      </motion.button>
    </motion.li>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <p className="px-2 text-micro font-semibold text-muted-foreground uppercase tracking-wider mb-1">{title}</p>
      <ul className="space-y-0.5">
        <AnimatePresence initial={false}>{children}</AnimatePresence>
      </ul>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function CreateDuelModal({
  opponentId: initialOpponentId,
  opponentUsername: initialOpponentUsername,
  onClose,
  onCreated,
}) {
  const { tFallback } = useLanguage();
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();
  const tap = reduceMotion ? undefined : { scale: 0.97 };
  // Pin the page behind this overlay — see @/lib/scrollLock.
  useBodyScrollLock();

  const [step,         setStep]         = useState(initialOpponentId ? 'configure' : 'pick');
  const [opponent,     setOpponent]     = useState(
    initialOpponentId ? { id: initialOpponentId, username: initialOpponentUsername } : null
  );
  const [query,        setQuery]        = useState('');
  const [selectedType, setSelectedType] = useState('open');
  const [windowHours,  setWindowHours]  = useState(24);
  const [sendingId,    setSendingId]    = useState(null);
  const inputRef = useRef(null);

  const term = query.trim().replace(/^@/, '');
  const debounced = useDebounced(term, 250);
  const searching = debounced.length >= 2;

  // People you follow (empty query) or search results (two or more letters).
  const { data: candidates = [], isFetching, isPending } = useQuery({
    queryKey:  ['duelCandidates', user?.id, searching ? debounced.toLowerCase() : ''],
    queryFn:   () => searchDuelOpponents(searching ? debounced : ''),
    enabled:   !!user?.id && step === 'pick',
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });

  // People you have dueled, for the head-to-head record on each row.
  const { data: frequent = [] } = useQuery({
    queryKey:  ['frequentOpponents', user?.id],
    queryFn:   () => getFrequentOpponents(user.id),
    enabled:   !!user?.id && step === 'pick',
    staleTime: 5 * 60_000,
  });
  const statsById = useMemo(() => Object.fromEntries(frequent.map((f) => [f.id, f])), [frequent]);

  const typing   = term.length >= 2 && (term !== debounced || isFetching);
  const recent   = searching ? [] : frequent;
  const recentIds = new Set(recent.map((f) => f.id));
  const listed   = candidates.filter((c) => !recentIds.has(c.id));

  // Synchronous double-tap guard: `sendingId` state lags React renders, and
  // a fast double-tap used to create two duels and send two DMs.
  const sendingRef = useRef(false);

  const send = async (profile, type, hours) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSendingId(profile.id);
    haptic('primary');
    try {
      const duel = await createDuel({ opponentId: profile.id, type, windowHours: hours });
      sendDuelDM(duel.id, profile.id, type, hours);
      haptic('success');
      toast.success(
        tFallback('createDuelModal.openDuelSent', '{type} sent to @{handle}!', {
          type: tFallback(`duel.type.${type}.name`, type === 'mirror' ? 'Mirror Duel' : 'Open Duel'),
          handle: profile.username,
        }),
        { description: tFallback('createDuelModal.windowAfterAccept', 'The {n}h window starts when they accept.', { n: hours }) },
      );
      onCreated?.(duel);
      onClose();
    } catch (err) {
      haptic('warning');
      toast.error(tFallback('createDuelModal.failedToSendChallenge', 'Failed to send challenge'), { description: duelErrorMessage(err, tFallback) });
    } finally {
      setSendingId(null);
      sendingRef.current = false;
    }
  };

  const handleSelectOpponent = (profile) => {
    setOpponent(profile);
    setStep('configure');
  };

  const handleCreate = () => {
    if (!opponent?.id) { toast.error(tFallback('createDuelModal.selectOpponent', 'Select an opponent first.')); return; }
    send(opponent, selectedType, windowHours);
  };

  const rowsFor = (list, offset = 0) => list.map((p, i) => (
    <OpponentRow
      key={p.id}
      profile={p}
      stats={statsById[p.id]}
      index={offset + i}
      onSelect={handleSelectOpponent}
      onQuickSend={(prof) => send(prof, 'open', 24)}
      sending={sendingId === p.id}
    />
  ));

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      <motion.div
        className="relative w-full max-w-md bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-md overflow-hidden pb-[env(safe-area-inset-bottom)]"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      >
        {/* Handle */}
        <div className="flex justify-center pt-3 pb-0 sm:hidden">
          <div className="w-10 h-1 rounded-full bg-border" />
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-3 border-b border-border">
          <div className="flex items-center gap-2 min-w-0">
            {step === 'configure' && !initialOpponentId && (
              <motion.button
                type="button"
                whileTap={tap}
                onClick={() => setStep('pick')}
                aria-label={tFallback('common.back', 'Back')}
                className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-secondary active:bg-secondary transition-colors"
              >
                <ArrowLeft className="w-4 h-4 text-muted-foreground rtl:scale-x-[-1]" />
              </motion.button>
            )}
            <div className="w-8 h-8 rounded-full bg-rose-500/10 flex items-center justify-center shrink-0">
              <Swords className="w-4 h-4 text-rose-500" />
            </div>
            <p className="text-sm font-bold truncate">
              {step === 'pick'
                ? tFallback('createDuelModal.challengeSomeone', 'Challenge someone')
                : tFallback('createDuelModal.duelHandle', 'Duel @{handle}', { handle: opponent?.username })}
            </p>
          </div>
          <motion.button
            type="button"
            whileTap={tap}
            onClick={onClose}
            aria-label={tFallback('common.close', 'Close')}
            className="w-9 h-9 flex items-center justify-center rounded-full hover:bg-secondary active:bg-secondary transition-colors"
          >
            <X className="w-4 h-4 text-muted-foreground" />
          </motion.button>
        </div>

        <AnimatePresence mode="wait" initial={false}>

          {/* ── STEP 1: Pick opponent ─────────────────────────────────── */}
          {step === 'pick' && (
            <motion.div
              key="pick"
              initial={reduceMotion ? false : { opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: -12 }}
              transition={{ duration: 0.16 }}
              className="flex flex-col"
            >
              <div className="px-4 pt-3 pb-2">
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    ref={inputRef}
                    autoFocus
                    type="search"
                    inputMode="search"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder={tFallback('createDuelModal.searchUsername', 'Search @username…')}
                    aria-label={tFallback('createDuelModal.searchUsername', 'Search @username…')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full h-11 ps-9 pe-10 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500/40 [&::-webkit-search-cancel-button]:hidden"
                  />
                  <div className="absolute end-1 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center">
                    {typing ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : query ? (
                      <motion.button
                        type="button"
                        whileTap={tap}
                        onClick={() => { setQuery(''); inputRef.current?.focus(); }}
                        aria-label={tFallback('createDuelModal.clearSearch', 'Clear search')}
                        className="w-9 h-9 flex items-center justify-center rounded-full text-muted-foreground hover:text-foreground active:text-foreground"
                      >
                        <X className="w-4 h-4" />
                      </motion.button>
                    ) : null}
                  </div>
                </div>
              </div>

              <div className="px-2 pb-5 overflow-y-auto max-h-[55vh] min-h-[220px]" aria-live="polite">
                {isPending && candidates.length === 0 ? (
                  <div className="px-2"><SkeletonRow /><SkeletonRow /><SkeletonRow /></div>
                ) : searching ? (
                  candidates.length > 0 ? (
                    <div className={`transition-opacity ${typing ? 'opacity-60' : ''}`}>
                      <Section title={tFallback('createDuelModal.results', 'Results')}>{rowsFor(candidates)}</Section>
                    </div>
                  ) : !typing ? (
                    <div className="py-10 text-center">
                      <UserCircle2 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">{tFallback('createDuelModal.noUsersFound', 'No one found for "{query}"', { query: debounced })}</p>
                    </div>
                  ) : (
                    <div className="px-2"><SkeletonRow /><SkeletonRow /></div>
                  )
                ) : recent.length + listed.length > 0 ? (
                  <div className="space-y-3">
                    {recent.length > 0 && (
                      <Section title={tFallback('createDuelModal.recentOpponents', 'Recent opponents')}>{rowsFor(recent)}</Section>
                    )}
                    {listed.length > 0 && (
                      <Section title={tFallback('createDuelModal.following', 'People you follow')}>{rowsFor(listed, recent.length)}</Section>
                    )}
                  </div>
                ) : (
                  <div className="py-10 text-center px-6">
                    <Search className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                    <p className="text-sm text-muted-foreground">{tFallback('createDuelModal.searchForSomeoneToChallenge', 'Search for someone to challenge')}</p>
                    <p className="text-xs text-muted-foreground/70 mt-1">{tFallback('createDuelModal.typeTwoLetters', 'Type at least two letters of their username.')}</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── STEP 2: Configure duel ────────────────────────────────── */}
          {step === 'configure' && (
            <motion.div
              key="configure"
              initial={reduceMotion ? false : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: 12 }}
              transition={{ duration: 0.16 }}
              className="px-4 py-4 space-y-5"
            >
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{tFallback('createDuelModal.duelType', 'Duel Type')}</p>
                {DUEL_TYPES.map(({ id, label, icon: Icon, description }) => {
                  const active = selectedType === id;
                  return (
                    <motion.button
                      key={id}
                      type="button"
                      whileTap={tap}
                      onClick={() => { if (!active) haptic('subtle'); setSelectedType(id); }}
                      aria-pressed={active}
                      className={`relative w-full flex items-start gap-3 p-3 rounded-xl border text-start transition-colors ${
                        active ? 'border-primary bg-primary/10' : 'border-border hover:bg-secondary/60 active:bg-secondary'
                      }`}
                    >
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-primary' : 'text-muted-foreground'}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold">{tFallback(`duel.type.${id}.name`, label)}</p>
                        <p className="text-xs mt-0.5 text-muted-foreground">{tFallback(`duel.type.${id}.rules`, description)}</p>
                        {id === 'mirror' && active && (
                          <p className="text-xs mt-1 text-primary font-medium">{tFallback('createDuelModal.mirrorCopies', 'Copies your last logged workout.')}</p>
                        )}
                      </div>
                      <span className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        active ? 'bg-primary border-primary text-primary-foreground' : 'border-border'
                      }`}>
                        {active && <Check className="w-3 h-3" />}
                      </span>
                    </motion.button>
                  );
                })}
              </div>

              {/* Time window: a segmented control with a sliding thumb. */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{tFallback('createDuelModal.timeWindow', 'Time Window')}</p>
                <div role="radiogroup" className="flex p-1 rounded-xl bg-secondary">
                  {WINDOWS.map((h) => {
                    const active = windowHours === h;
                    return (
                      <button
                        key={h}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        onClick={() => { if (!active) haptic('subtle'); setWindowHours(h); }}
                        className={`relative flex-1 h-10 rounded-lg text-sm font-bold transition-colors ${active ? 'text-primary-foreground' : 'text-muted-foreground'}`}
                      >
                        {active && (
                          <motion.span
                            layoutId="duel-window-thumb"
                            transition={reduceMotion ? { duration: 0 } : { type: 'spring', damping: 30, stiffness: 400 }}
                            className="absolute inset-0 rounded-lg bg-primary"
                          />
                        )}
                        <span className="relative">{tFallback('createDuelModal.hours', '{n}h', { n: h })}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground mt-2">{tFallback('createDuelModal.windowAfterAccept', 'The {n}h window starts when they accept.', { n: windowHours })}</p>
              </div>

              <motion.button
                type="button"
                whileTap={sendingId ? undefined : tap}
                onClick={handleCreate}
                disabled={!!sendingId}
                className="w-full h-12 flex items-center justify-center gap-2 rounded-xl bg-rose-500 text-white font-bold text-sm hover:bg-rose-600 active:bg-rose-600 disabled:opacity-60 transition-colors"
              >
                {sendingId
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><Swords className="w-4 h-4" /> {tFallback('createDuelModal.challengeHandle', 'Challenge @{handle}', { handle: opponent?.username })}</>}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
