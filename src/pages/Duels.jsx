// src/pages/Duels.jsx
// Full duels hub — active duels, history, challenge someone.

import React, { useState } from 'react';
import { AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Swords, Trophy, Plus, Dumbbell, Timer, Crown } from 'lucide-react';
import { listMyDuels } from '@/lib/data/duels';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import CreateDuelModal from '@/components/duels/CreateDuelModal';
import DuelDetailSheet from '@/components/duels/DuelDetailSheet';
import CreateInviteLinkModal from '@/components/duels/CreateInviteLinkModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Link as LinkIcon } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

// Static config keyed by status; the visible label is resolved at render
// time via t() so the same English fallback works for every locale.
const STATUS_CONFIG = {
  pending:   { i18nKey: 'duels.status.pending',   fallback: 'Pending',   color: 'text-amber-500',         bg: 'bg-amber-500/10 border-amber-500/20' },
  active:    { i18nKey: 'duels.status.active',    fallback: 'Active',    color: 'text-primary',           bg: 'bg-primary/10 border-primary/20' },
  completed: { i18nKey: 'duels.status.completed', fallback: 'Complete',  color: 'text-emerald-500',       bg: 'bg-emerald-500/10 border-emerald-500/20' },
  declined:  { i18nKey: 'duels.status.declined',  fallback: 'Declined',  color: 'text-rose-500',          bg: 'bg-rose-500/10 border-rose-500/20' },
  expired:   { i18nKey: 'duels.status.expired',   fallback: 'Expired',   color: 'text-muted-foreground',  bg: 'bg-secondary' },
};

const TYPE_ICON = { mirror: Dumbbell, open: Timer, exercise: Trophy };

function DuelRow({ duel, currentUserId, onClick }) {
  const { t, tFallback } = useLanguage();
  const isChallenger = duel.challenger_id === currentUserId;
  const won          = duel.winner_id === currentUserId;
  const lost         = duel.winner_id && duel.winner_id !== currentUserId;
  const cfg          = STATUS_CONFIG[duel.status] || STATUS_CONFIG.expired;
  const Icon         = TYPE_ICON[duel.type] || Swords;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-secondary/40 transition-colors text-left"
    >
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        {duel.status === 'completed'
          ? <Crown className={`w-4 h-4 ${won ? 'text-primary' : 'text-muted-foreground'}`} />
          : <Icon className="w-4 h-4 text-primary" />
        }
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">
          {isChallenger
            ? (tFallback('duels.youChallenged', 'You challenged'))
            : (tFallback('duels.challengedBy', 'Challenged by'))} ·{' '}
          <span className="text-muted-foreground capitalize">{duel.type}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(duel.created_at), { addSuffix: true })}
        </p>
      </div>
      {duel.status === 'completed' && (
        <span className={`text-xs font-bold ${won ? 'text-primary' : lost ? 'text-rose-500' : 'text-amber-500'}`}>
          {won
            ? (tFallback('duels.resultWin', 'W'))
            : lost
              ? (tFallback('duels.resultLoss', 'L'))
              : (tFallback('duels.resultTie', 'TIE'))}
        </span>
      )}
      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
        {t(cfg.i18nKey) || cfg.fallback}
      </span>
    </button>
  );
}

export default function Duels() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [showCreate,    setShowCreate]    = useState(false);
  const [showInviteLink, setShowInviteLink] = useState(false);
  const [selectedDuel,  setSelectedDuel]  = useState(null);

  const { data: duels = [], isLoading } = useQuery({
    queryKey:  ['myDuels', user?.id],
    queryFn:   listMyDuels,
    enabled:   !!user?.id,
    staleTime: 30_000,
  });

  const active    = duels.filter(d => ['pending', 'active'].includes(d.status));
  const history   = duels.filter(d => ['completed', 'declined', 'expired'].includes(d.status));
  const wins      = duels.filter(d => d.winner_id === user?.id).length;
  const losses    = duels.filter(d => d.status === 'completed' && d.winner_id && d.winner_id !== user?.id).length;

  return (
    <ErrorBoundary label="Duels">
    <div className="min-h-screen bg-background pb-24">
      {/* Header */}
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <Swords className="w-5 h-5 text-primary" />
            <h1 className="text-xl font-black">Duels</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInviteLink(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-secondary text-foreground text-xs font-bold border border-border hover:bg-secondary/70 transition-colors"
              aria-label="Challenge someone by link"
            >
              <LinkIcon className="w-3.5 h-3.5" />
              Invite link
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-bold hover:bg-primary/90 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Challenge
            </button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">Head-to-head workout battles</p>
      </div>

      {/* W/L record */}
      {(wins > 0 || losses > 0) && (
        <div className="mx-4 mb-4 flex gap-3">
          <div className="flex-1 rounded-xl bg-primary/8 border border-primary/20 p-3 text-center">
            <p className="text-2xl font-black text-primary">{wins}</p>
            <p className="text-xs text-muted-foreground">Wins</p>
          </div>
          <div className="flex-1 rounded-xl bg-rose-500/8 border border-rose-500/20 p-3 text-center">
            <p className="text-2xl font-black text-rose-500">{losses}</p>
            <p className="text-xs text-muted-foreground">Losses</p>
          </div>
          <div className="flex-1 rounded-xl bg-secondary border border-border p-3 text-center">
            <p className="text-2xl font-black">{duels.filter(d => d.status === 'completed').length}</p>
            <p className="text-xs text-muted-foreground">Total</p>
          </div>
        </div>
      )}

      <div className="px-4 space-y-5">
        {/* Active */}
        {active.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Active</p>
            <div className="space-y-2">
              {active.map(d => (
                <DuelRow key={d.id} duel={d} currentUserId={user?.id} onClick={() => setSelectedDuel(d)} />
              ))}
            </div>
          </div>
        )}

        {/* History */}
        {history.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">History</p>
            <div className="space-y-2">
              {history.map(d => (
                <DuelRow key={d.id} duel={d} currentUserId={user?.id} onClick={() => setSelectedDuel(d)} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && duels.length === 0 && (
          <div className="text-center py-16">
            <Swords className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-semibold text-muted-foreground">No duels yet</p>
            <p className="text-sm text-muted-foreground/60 mt-1">Challenge someone from their profile</p>
          </div>
        )}
      </div>

      {/* Modals */}
      <AnimatePresence>
        <CreateInviteLinkModal
          open={showInviteLink}
          onOpenChange={setShowInviteLink}
        />

        {showCreate && (
          <CreateDuelModal
            opponentId={null}
            opponentUsername="someone"
            onClose={() => setShowCreate(false)}
            onCreated={() => qc.invalidateQueries({ queryKey: ['myDuels'] })}
          />
        )}
        {selectedDuel && (
          <DuelDetailSheet
            duel={selectedDuel}
            currentUserId={user?.id}
            onClose={() => setSelectedDuel(null)}
          />
        )}
      </AnimatePresence>
    </div>
    </ErrorBoundary>
  );
}
