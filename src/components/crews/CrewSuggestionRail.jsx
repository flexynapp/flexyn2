// src/components/crews/CrewSuggestionRail.jsx
//
// Horizontal rail of suggested crews shown at the top of the Hub
// "My Crews" surface. Backed by migration 090's get_suggested_crews()
// RPC — non-full crews the caller isn't yet a member of, sorted by
// member count DESC.
//
// PURPOSE
// ───────
// Migration 069 wired up crew_war_started / crew_war_resolved push
// notifications. Migrations 055-076 built the entire Crew Wars feature.
// All of it is dead UI for users who aren't in a crew — and most users
// aren't, because joining required hunting through someone else's
// invite or hand-typing a crew name. This rail puts "join a crew" one
// tap away the first time a user opens the Crews tab.
//
// AUTO-HIDE
// ─────────
// Hides when:
//   • the RPC returns 0 suggestions (no joinable crews exist)
//   • the rail has been collapsed/dismissed by the user (per-user
//     localStorage)
// Re-shows in the next 7 days if the user dismissed and then later
// LEAVES all their crews — but for now keep dismissal permanent.

import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { Shield, Users, Plus, X, Loader2 } from 'lucide-react';
import { useNumberFormatter } from '@/lib/intl';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as crewsData from '@/lib/data/crews';

const DISMISS_KEY = (userId) => `flexyn.crewSuggestionDismissed.${userId || 'anon'}`;

function readDismissed(userId) {
  try { return localStorage.getItem(DISMISS_KEY(userId)) === '1'; }
  catch { return false; }
}
function writeDismissed(userId) {
  try { localStorage.setItem(DISMISS_KEY(userId), '1'); }
  catch { /* best-effort */ }
}

function SuggestedCrewCard({ crew, onJoin, joining }) {
  const fmt = useNumberFormatter();
  const fullness = Math.min(1, (crew.member_count || 0) / (crew.max_capacity || 16));
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className="shrink-0 w-44 rounded-2xl bg-card p-3 flex flex-col gap-2"
    >
      <div className="flex items-start gap-2">
        <div className="w-9 h-9 rounded-lg bg-primary/12 flex items-center justify-center shrink-0">
          <Shield className="w-4 h-4 text-primary" aria-hidden="true" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-heading font-bold text-sm leading-tight truncate">{crew.name}</p>
          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <Users className="w-3 h-3" aria-hidden="true" />
            <span className="tabular-nums">{fmt(crew.member_count || 0)}</span>
            <span>/</span>
            <span className="tabular-nums">{fmt(crew.max_capacity || 16)}</span>
          </p>
        </div>
      </div>

      {/* Fullness bar — visual cue that the crew is filling up.
          Subtly nudges urgency without being aggressive. */}
      <div className="h-1 rounded-full bg-secondary overflow-hidden">
        <div
          className="h-full bg-primary"
          style={{ width: `${Math.round(fullness * 100)}%` }}
        />
      </div>

      <button
        onClick={onJoin}
        disabled={joining}
        className="mt-auto flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-bold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
      >
        {joining ? (
          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        ) : (
          <Plus className="w-3 h-3" aria-hidden="true" />
        )}
        <span>{joining ? 'Joining…' : 'Join'}</span>
      </button>
    </motion.div>
  );
}

export default function CrewSuggestionRail() {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const qc = useQueryClient();
  const [dismissed, setDismissed] = useState(() => readDismissed(user?.id));
  const [joiningId, setJoiningId] = useState(null);

  const { data: suggestions = [] } = useQuery({
    queryKey: ['suggestedCrews', user?.id],
    queryFn: () => crewsData.getSuggestedCrews(5),
    enabled: !!user?.id && !dismissed,
    staleTime: 60_000,
  });

  const handleDismiss = () => {
    writeDismissed(user?.id);
    setDismissed(true);
  };

  const handleJoin = async (crewId) => {
    if (joiningId || !user?.id) return;
    setJoiningId(crewId);
    try {
      await crewsData.joinCrew(crewId, user.id);
      toast.success(tFallback('crewSuggestion.joined', "Joined! You're in — head to the crew chat to say hi."));
      // Refresh: the joined crew is now in "my crews" + must be excluded
      // from the suggestion rail.
      qc.invalidateQueries({ queryKey: ['myCrews', user.id] });
      qc.invalidateQueries({ queryKey: ['suggestedCrews', user.id] });
    } catch (err) {
      // Most likely failure: crew became full between render + tap, or
      // the user was already a member from another tab. Both are
      // transient; refetch to get the latest suggestions.
      console.warn('[crewSuggestion] join failed:', err?.message || err);
      toast.error(tFallback('crewSuggestion.joinFailed', "Could not join — that crew may now be full."));
      qc.invalidateQueries({ queryKey: ['suggestedCrews', user.id] });
    } finally {
      setJoiningId(null);
    }
  };

  if (!user?.id || dismissed || suggestions.length === 0) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="mb-4"
        role="region"
        aria-label={tFallback('crewSuggestion.aria', 'Suggested crews to join')}
      >
        <div className="flex items-center justify-between mb-2 px-1">
          <div className="flex items-center gap-2">
            <Shield className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
            <span className="text-xs font-bold text-primary">
              {tFallback('crewSuggestion.title', 'Suggested crews')}
            </span>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 -me-1 rounded-md text-muted-foreground/70 hover:text-foreground hover:bg-foreground/5 transition-colors"
            aria-label={tFallback('crewSuggestion.dismiss', 'Hide suggestions')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex gap-2.5 overflow-x-auto pb-1 px-1 -mx-1 scrollbar-hide">
          {suggestions.map((c) => (
            <SuggestedCrewCard
              key={c.id}
              crew={c}
              joining={joiningId === c.id}
              onJoin={() => handleJoin(c.id)}
            />
          ))}
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
