// src/components/duels/CreateDuelModal.jsx
// Two-step challenge flow:
//   Step 1 — Pick opponent: friends list (quick-send ✈) + search, sorted by duel frequency
//   Step 2 — Configure: duel type + time window → send (fires DM to opponent)

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X, Swords, Dumbbell, Timer, Trophy, Loader2, Search, UserCircle2,
  ArrowLeft, SendHorizonal,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { createDuel, getFrequentOpponents, sendDuelDM } from '@/lib/data/duels';
import { supabase } from '@/api/supabaseClient';
import { selectProfiles } from '@/lib/data/users';
import { useAuth } from '@/lib/AuthContext';
import { toast } from '@/lib/toast';

// ── Duel type config ──────────────────────────────────────────────────────────

const DUEL_TYPES = [
  {
    id:          'open',
    label:       'Open Duel',
    icon:        Timer,
    activeBg:    'bg-primary border-primary',
    idleBg:      'bg-primary/10 border-primary/30',
    color:       'text-primary',
    description: 'Train freely in the time window. Most total volume wins.',
  },
  {
    id:          'mirror',
    label:       'Mirror Duel',
    icon:        Dumbbell,
    activeBg:    'bg-violet-500 border-violet-500',
    idleBg:      'bg-violet-500/10 border-violet-500/30',
    color:       'text-violet-500',
    description: 'Opponent completes your exact session. Scored on completion % + volume.',
  },
  {
    id:          'exercise',
    label:       'Exercise Duel',
    icon:        Trophy,
    activeBg:    'bg-amber-500 border-amber-500',
    idleBg:      'bg-amber-500/10 border-amber-500/30',
    color:       'text-amber-500',
    description: 'Single exercise showdown — most reps or highest weight.',
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function searchUsers(query, currentUserId) {
  if (!query || query.length < 2) return [];
  const { data } = await selectProfiles((from) => from
    .select('id, username, avatar_url, current_level')
    .ilike('username', `%${query}%`)
    .neq('id', currentUserId)
    .not('username', 'is', null)
    .limit(8));
  return data ?? [];
}

async function getFriends(userEmail, currentUserId) {
  if (!userEmail) return [];
  const { data: follows } = await supabase
    .from('hub_follows')
    .select('followee_id')
    .eq('follower_email', userEmail)
    .limit(50);
  if (!follows?.length) return [];
  const ids = follows.map(f => f.followee_id).filter(Boolean);
  if (!ids.length) return [];
  const { data: profiles } = await selectProfiles((from) => from
    .select('id, username, avatar_url, current_level')
    .in('id', ids)
    .neq('id', currentUserId)
    .not('username', 'is', null)
    .limit(20));
  return profiles ?? [];
}

// ── Avatar ────────────────────────────────────────────────────────────────────

function Avatar({ profile, size = 'md' }) {
  const dim = size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
  return profile.avatar_url ? (
    <img loading="lazy" src={profile.avatar_url} className={`${dim} rounded-full object-cover shrink-0`} alt={profile.username} />
  ) : (
    <div className={`${dim} rounded-full bg-primary/15 flex items-center justify-center shrink-0`}>
      <span className={`font-black text-primary`}>{profile.username?.[0]?.toUpperCase()}</span>
    </div>
  );
}

// ── H2H badge ─────────────────────────────────────────────────────────────────

function H2HBadge({ wins, losses }) {
  if (wins === 0 && losses === 0) return null;
  return (
    <span className="text-micro font-bold tabular-nums text-muted-foreground shrink-0">
      <span className="text-primary">{wins}W</span>
      {' · '}
      <span className="text-rose-500">{losses}L</span>
    </span>
  );
}

// ── Friend row (quick-send) ───────────────────────────────────────────────────

function FriendRow({ profile, stats, onQuickSend, onSelect }) {
  const wins   = stats?.wins   ?? 0;
  const losses = stats?.losses ?? 0;

  return (
    <div className="flex items-center gap-2.5 px-1 py-1.5 rounded-xl hover:bg-secondary/40 transition-colors group">
      <button onClick={() => onSelect(profile)} className="flex items-center gap-2.5 flex-1 min-w-0 text-start">
        <Avatar profile={profile} size="sm" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">@{profile.username}</p>
          <p className="text-micro text-muted-foreground">Lv {profile.current_level ?? '—'}</p>
        </div>
        <H2HBadge wins={wins} losses={losses} />
      </button>
      {/* Quick-send paper airplane */}
      <button
        onClick={() => onQuickSend(profile)}
        className="p-2 rounded-lg bg-rose-500/10 hover:bg-rose-500/20 text-rose-500 transition-colors shrink-0"
        title={`Quick challenge @${profile.username}`}
      >
        <SendHorizonal className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function CreateDuelModal({
  opponentId: initialOpponentId,
  opponentUsername: initialOpponentUsername,
  recentSession = null,
  onClose,
  onCreated,
}) {
  const { user } = useAuth();

  const [step,         setStep]         = useState(initialOpponentId ? 'configure' : 'pick');
  const [opponent,     setOpponent]     = useState(
    initialOpponentId ? { id: initialOpponentId, username: initialOpponentUsername } : null
  );
  const [query,        setQuery]        = useState('');
  const [results,      setResults]      = useState([]);
  const [searching,    setSearching]    = useState(false);
  const [selectedType, setSelectedType] = useState('open');
  const [windowHours,  setWindowHours]  = useState(24);
  const [loading,      setLoading]      = useState(false);

  const debounceRef = useRef(null);

  // Friends list
  const { data: friends = [] } = useQuery({
    queryKey:  ['duelFriends', user?.email, user?.id],
    queryFn:   () => getFriends(user.email, user.id),
    enabled:   !!user?.email && step === 'pick',
    staleTime: 5 * 60_000,
  });

  // Frequent opponents (have been dueled before)
  const { data: frequent = [] } = useQuery({
    queryKey:  ['frequentOpponents', user?.id],
    queryFn:   () => getFrequentOpponents(user.id),
    enabled:   !!user?.id && step === 'pick',
    staleTime: 5 * 60_000,
  });

  // Merge friends + frequent, dedup, sort frequents first
  const frequentIds  = new Set(frequent.map(f => f.id));
  const frequentMap  = Object.fromEntries(frequent.map(f => [f.id, f]));
  const friendsOnly  = friends.filter(f => !frequentIds.has(f.id));
  const suggestedList = [
    ...frequent,               // most-dueled first (already sorted by count)
    ...friendsOnly,            // remaining friends alphabetically
  ];

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (query.length < 2) { setResults([]); return; }
    setSearching(true);
    debounceRef.current = setTimeout(async () => {
      const res = await searchUsers(query, user?.id);
      setResults(res);
      setSearching(false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, user?.id]);

  const handleSelectOpponent = (profile) => {
    setOpponent(profile);
    setStep('configure');
  };

  // Synchronous double-tap guards. `loading` state lags React renders
  // — a fast double-tap fires createDuel twice → two duels rows + two
  // DM invites to the opponent. Wave 57 (Duels audit) caught this.
  const quickSendRef = useRef(false);
  const createRef = useRef(false);

  // Quick-send: select opponent and immediately send with default Open / 24h
  const handleQuickSend = async (profile) => {
    if (quickSendRef.current) return;
    quickSendRef.current = true;
    setOpponent(profile);
    setLoading(true);
    try {
      const duel = await createDuel({
        opponentId:  profile.id,
        type:        'open',
        windowHours: 24,
      });
      sendDuelDM(duel.id, profile.id, 'open', 24);
      toast.success(`Open Duel sent to @${profile.username}!`, { description: '24h window · Most volume wins' });
      onCreated?.(duel);
      onClose();
    } catch (err) {
      toast.error('Failed to send challenge', { description: err.message });
    } finally {
      setLoading(false);
      quickSendRef.current = false;
    }
  };

  const handleCreate = async () => {
    if (!opponent?.id) { toast.error('Select an opponent first.'); return; }
    if (createRef.current) return;
    createRef.current = true;
    setLoading(true);
    try {
      const sessionTemplate = selectedType === 'mirror' && recentSession
        ? { exercises: recentSession.exercises, name: recentSession.regimen_name }
        : null;

      const duel = await createDuel({
        opponentId: opponent.id,
        type:       selectedType,
        sessionTemplate,
        windowHours,
      });
      sendDuelDM(duel.id, opponent.id, selectedType, windowHours);
      toast.success(`Duel challenge sent to @${opponent.username}!`, {
        description: `${windowHours}h window · Check their DMs.`,
      });
      onCreated?.(duel);
      onClose();
    } catch (err) {
      toast.error('Failed to send challenge', { description: err.message });
    } finally {
      setLoading(false);
      createRef.current = false;
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        className="relative w-full max-w-md bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
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
        <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            {step === 'configure' && !initialOpponentId && (
              <button onClick={() => setStep('pick')} className="p-1.5 rounded-full hover:bg-secondary transition-colors">
                <ArrowLeft className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            <div className="w-7 h-7 rounded-full bg-rose-500/10 flex items-center justify-center">
              <Swords className="w-3.5 h-3.5 text-rose-500" />
            </div>
            <p className="text-sm font-bold">
              {step === 'pick' ? 'Challenge Someone' : `Duel @${opponent?.username}`}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-secondary transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <AnimatePresence mode="wait">

          {/* ── STEP 1: Pick opponent ─────────────────────────────────── */}
          {step === 'pick' && (
            <motion.div
              key="pick"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className="flex flex-col"
            >
              {/* Search bar */}
              <div className="px-4 pt-3 pb-2">
                <div className="relative">
                  <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <input
                    autoFocus
                    type="text"
                    placeholder="Search @username…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="w-full ps-9 pe-4 py-2.5 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500/40"
                  />
                  {searching && (
                    <Loader2 className="absolute end-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
                  )}
                </div>
              </div>

              {/* List area */}
              <div className="px-4 pb-5 overflow-y-auto max-h-[380px]">
                {query.length >= 2 ? (
                  // ── Search results ──────────────────────────────────
                  results.length > 0 ? (
                    <div className="space-y-0.5">
                      {results.map(p => (
                        <FriendRow
                          key={p.id}
                          profile={p}
                          stats={frequentMap[p.id]}
                          onSelect={handleSelectOpponent}
                          onQuickSend={handleQuickSend}
                        />
                      ))}
                    </div>
                  ) : !searching ? (
                    <div className="py-10 text-center">
                      <UserCircle2 className="w-8 h-8 text-muted-foreground/30 mx-auto mb-2" />
                      <p className="text-sm text-muted-foreground">No users found for "{query}"</p>
                    </div>
                  ) : null
                ) : (
                  // ── Suggested: frequent + friends ────────────────────
                  suggestedList.length > 0 ? (
                    <div>
                      <p className="text-micro font-semibold text-muted-foreground uppercase tracking-wider mb-2">
                        {frequent.length > 0 ? 'Recent Rivals & Friends' : 'Friends'}
                      </p>
                      <div className="space-y-0.5">
                        {suggestedList.map(p => (
                          <FriendRow
                            key={p.id}
                            profile={p}
                            stats={frequentMap[p.id]}
                            onSelect={handleSelectOpponent}
                            onQuickSend={handleQuickSend}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="py-10 text-center">
                      <Search className="w-8 h-8 text-muted-foreground/20 mx-auto mb-2" />
                      <p className="text-xs text-muted-foreground">Search for someone to challenge</p>
                    </div>
                  )
                )}
              </div>
            </motion.div>
          )}

          {/* ── STEP 2: Configure duel ────────────────────────────────── */}
          {step === 'configure' && (
            <motion.div
              key="configure"
              initial={{ opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 12 }}
              className="px-5 py-4 space-y-4"
            >
              {/* Duel type */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Duel Type</p>
                {DUEL_TYPES.map(({ id, label, icon: Icon, activeBg, idleBg, color, description }) => {
                  const active = selectedType === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setSelectedType(id)}
                      className={`w-full flex items-start gap-3 p-3 rounded-xl border text-start transition-all ${
                        active ? `${activeBg} text-white` : `${idleBg} hover:opacity-80`
                      }`}
                    >
                      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${active ? 'text-white' : color}`} />
                      <div>
                        <p className={`text-sm font-semibold ${active ? 'text-white' : ''}`}>{label}</p>
                        <p className={`text-xs mt-0.5 ${active ? 'text-white/80' : 'text-muted-foreground'}`}>{description}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Mirror template */}
              {selectedType === 'mirror' && (
                <div className="rounded-xl bg-secondary/50 border border-border p-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Session Template</p>
                  {recentSession ? (
                    <p className="text-sm font-medium">{recentSession.regimen_name || 'Your last workout'}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No recent session found.</p>
                  )}
                </div>
              )}

              {/* Time window */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Time Window</p>
                <div className="flex gap-2">
                  {[12, 24, 48, 72].map(h => (
                    <button
                      key={h}
                      onClick={() => setWindowHours(h)}
                      className={`flex-1 py-2 rounded-lg text-xs font-bold border transition-all ${
                        windowHours === h
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-border hover:border-primary/40'
                      }`}
                    >
                      {h}h
                    </button>
                  ))}
                </div>
              </div>

              {/* Send */}
              <button
                onClick={handleCreate}
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-rose-500 text-white font-bold text-sm hover:bg-rose-600 disabled:opacity-50 transition-colors"
              >
                {loading
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : <><Swords className="w-4 h-4" /> Challenge @{opponent?.username}</>
                }
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
