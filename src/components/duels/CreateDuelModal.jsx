// src/components/duels/CreateDuelModal.jsx
// Challenge flow — search for opponent, pick duel type, send invite.
// Opponent receives an in-app notification + the duel appears in their /duels page.

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Swords, Dumbbell, Timer, Trophy, ChevronRight, Loader2, Search, UserCircle2, ArrowLeft } from 'lucide-react';
import { createDuel } from '@/lib/data/duels';
import { supabase } from '@/api/supabaseClient';
import { useAuth } from '@/lib/AuthContext';
import { toast } from 'sonner';

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

// ── User search ───────────────────────────────────────────────────────────────

async function searchUsers(query, currentUserId) {
  if (!query || query.length < 2) return [];
  const { data, error } = await supabase
    .from('user_profiles')
    .select('id, username, avatar_url, current_level')
    .ilike('username', `%${query}%`)
    .neq('id', currentUserId)
    .limit(8);
  return error ? [] : (data ?? []);
}

// ── Sub-components ────────────────────────────────────────────────────────────

function UserRow({ profile, onSelect }) {
  return (
    <button
      onClick={() => onSelect(profile)}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-secondary/60 transition-colors text-left"
    >
      {profile.avatar_url ? (
        <img src={profile.avatar_url} className="w-9 h-9 rounded-full object-cover shrink-0" alt={profile.username} />
      ) : (
        <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
          <span className="text-sm font-black text-primary">{profile.username?.[0]?.toUpperCase()}</span>
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">@{profile.username}</p>
        <p className="text-xs text-muted-foreground">Level {profile.current_level ?? '—'}</p>
      </div>
      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
    </button>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────

export default function CreateDuelModal({ opponentId: initialOpponentId, opponentUsername: initialOpponentUsername, recentSession = null, onClose, onCreated }) {
  const { user } = useAuth();

  // Step: 'pick' (choose opponent) or 'configure' (type + window)
  const [step,           setStep]           = useState(initialOpponentId ? 'configure' : 'pick');
  const [opponent,       setOpponent]       = useState(
    initialOpponentId ? { id: initialOpponentId, username: initialOpponentUsername } : null
  );

  // Opponent search
  const [query,          setQuery]          = useState('');
  const [results,        setResults]        = useState([]);
  const [searching,      setSearching]      = useState(false);
  const debounceRef = useRef(null);

  // Duel config
  const [selectedType,   setSelectedType]   = useState('open');
  const [windowHours,    setWindowHours]    = useState(24);
  const [loading,        setLoading]        = useState(false);

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

  const handleCreate = async () => {
    if (!opponent?.id) { toast.error('Please select an opponent first.'); return; }
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

      toast.success(`Duel challenge sent to @${opponent.username}!`, {
        description: `They have ${windowHours}h to accept.`,
      });
      onCreated?.(duel);
      onClose();
    } catch (err) {
      toast.error('Failed to send challenge', { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <motion.div
        className="relative w-full max-w-md bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl overflow-hidden"
        initial={{ y: 60, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 60, opacity: 0 }}
        transition={{ type: 'spring', damping: 28, stiffness: 280 }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-border">
          <div className="flex items-center gap-2.5">
            {step === 'configure' && !initialOpponentId && (
              <button onClick={() => setStep('pick')} className="p-1.5 rounded-full hover:bg-secondary transition-colors mr-0.5">
                <ArrowLeft className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
            <div className="w-7 h-7 rounded-full bg-rose-500/10 flex items-center justify-center">
              <Swords className="w-3.5 h-3.5 text-rose-500" />
            </div>
            <div>
              <p className="text-sm font-bold">
                {step === 'pick' ? 'Choose Opponent' : `Challenge @${opponent?.username}`}
              </p>
              {step === 'configure' && (
                <p className="text-xs text-muted-foreground">Pick your duel type</p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-full hover:bg-secondary transition-colors">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        <AnimatePresence mode="wait">
          {/* ── Step 1: Pick opponent ─────────────────────────────────── */}
          {step === 'pick' && (
            <motion.div
              key="pick"
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              className="px-5 py-4 space-y-3"
            >
              {/* Search input */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search by @username…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-secondary border border-border text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/50"
                />
                {searching && (
                  <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 animate-spin text-muted-foreground" />
                )}
              </div>

              {/* Results */}
              <div className="min-h-[120px] max-h-[300px] overflow-y-auto -mx-1 px-1">
                {results.length > 0 ? (
                  <div className="space-y-0.5">
                    {results.map(p => (
                      <UserRow key={p.id} profile={p} onSelect={handleSelectOpponent} />
                    ))}
                  </div>
                ) : query.length >= 2 && !searching ? (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <UserCircle2 className="w-8 h-8 text-muted-foreground/30 mb-2" />
                    <p className="text-sm text-muted-foreground">No users found for "{query}"</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-10 text-center">
                    <Search className="w-8 h-8 text-muted-foreground/20 mb-2" />
                    <p className="text-xs text-muted-foreground">Type at least 2 characters to search</p>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {/* ── Step 2: Configure duel ────────────────────────────────── */}
          {step === 'configure' && (
            <motion.div
              key="configure"
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 16 }}
              className="px-5 py-4 space-y-4"
            >
              {/* Duel type selection */}
              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Duel Type</p>
                {DUEL_TYPES.map(({ id, label, icon: Icon, activeBg, idleBg, color, description }) => {
                  const active = selectedType === id;
                  return (
                    <button
                      key={id}
                      onClick={() => setSelectedType(id)}
                      className={`w-full flex items-start gap-3 p-3 rounded-xl border text-left transition-all ${
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

              {/* Mirror — session template info */}
              {selectedType === 'mirror' && (
                <div className="rounded-xl bg-secondary/50 border border-border p-3">
                  <p className="text-xs font-semibold text-muted-foreground mb-1">Session Template</p>
                  {recentSession ? (
                    <p className="text-sm font-medium">{recentSession.regimen_name || 'Your last workout'}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No recent session — opponent sees a blank template.</p>
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
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <Swords className="w-4 h-4" />
                    Send Challenge to @{opponent?.username}
                  </>
                )}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
