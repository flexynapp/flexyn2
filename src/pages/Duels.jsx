// src/pages/Duels.jsx
// Full duels hub — active duels, history, challenge someone.

import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Swords, Trophy, Plus, Dumbbell, Timer, Crown, ArrowLeft } from 'lucide-react';
import { toast } from '@/lib/toast';
import { listMyDuels, cancelDuel } from '@/lib/data/duels';
import { selectProfiles } from '@/lib/data/users';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import CreateDuelModal from '@/components/duels/CreateDuelModal';
import DuelDetailSheet from '@/components/duels/DuelDetailSheet';
import CreateInviteLinkModal from '@/components/duels/CreateInviteLinkModal';
import ErrorBoundary from '@/components/ErrorBoundary';
import { Link as LinkIcon } from 'lucide-react';
import { formatRelativeDate } from '@/lib/formatRelativeDate';

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

function DuelRow({ duel, currentUserId, opponent, onClick }) {
  const { t, tFallback } = useLanguage();
  const isChallenger = duel.challenger_id === currentUserId;
  const won          = duel.winner_id === currentUserId;
  const lost         = duel.winner_id && duel.winner_id !== currentUserId;
  const cfg          = STATUS_CONFIG[duel.status] || STATUS_CONFIG.expired;
  const Icon         = TYPE_ICON[duel.type] || Swords;
  const opponentName = opponent?.username ? `@${opponent.username}` : null;

  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 p-3 rounded-xl border border-border bg-card hover:bg-secondary/40 active:bg-secondary/40 transition-colors text-start"
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
            : (tFallback('duels.challengedBy', 'Challenged by'))}
          {opponentName ? <span className="text-foreground"> {opponentName}</span> : null} ·{' '}
          <span className="text-muted-foreground capitalize">{duel.type}</span>
        </p>
        {/* Deadline countdown for active/pending duels */}
        {['pending', 'active'].includes(duel.status) && duel.expires_at && (() => {
          const minsLeft = Math.max(0, Math.round((new Date(duel.expires_at) - Date.now()) / 60_000));
          const hoursLeft = Math.floor(minsLeft / 60);
          const label = hoursLeft >= 48
            ? `${Math.floor(hoursLeft / 24)}d left`
            : hoursLeft >= 1
              ? `${hoursLeft}h left`
              : minsLeft > 0 ? `${minsLeft}m left` : 'Expires soon';
          const urgent = hoursLeft < 6;
          return (
            <p className={`text-xs mt-0.5 ${urgent ? 'text-rose-500 font-semibold' : 'text-muted-foreground'}`}>
              {label}
            </p>
          );
        })()}
        {/* Score summary for completed duels */}
        {duel.status === 'completed' && (() => {
          const myResult   = isChallenger ? duel.challenger_result : duel.opponent_result;
          const theirResult = isChallenger ? duel.opponent_result  : duel.challenger_result;
          const myVol   = myResult?.volume    ?? myResult?.weight ?? myResult?.reps ?? null;
          const theirVol = theirResult?.volume ?? theirResult?.weight ?? theirResult?.reps ?? null;
          if (myVol == null && theirVol == null) return <p className="text-xs text-muted-foreground mt-0.5">{formatRelativeDate(duel.created_at, { variant: 'short' })}</p>;
          return (
            <p className="text-xs text-muted-foreground mt-0.5">
              {myVol != null ? Math.round(myVol).toLocaleString() : '—'} vs {theirVol != null ? Math.round(theirVol).toLocaleString() : '—'}
            </p>
          );
        })()}
        {!['pending','active','completed'].includes(duel.status) && (
          <p className="text-xs text-muted-foreground">
            {formatRelativeDate(duel.created_at, { variant: 'short' })}
          </p>
        )}
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
      <span className={`text-micro font-semibold px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color}`}>
        {t(cfg.i18nKey) || cfg.fallback}
      </span>
    </button>
  );
}

export default function Duels() {
  const navigate = useNavigate();
  const { user } = useAuth();
  // The component referenced tFallback on line ~146 without calling
  // useLanguage() at the top of Duels() — only DuelRow destructured
  // it. Latent ReferenceError that hadn't fired yet via Babel/Vite
  // hoisting quirks. Adding the destructure makes the reference real.
  // (Audit 15 #M1.)
  const { tFallback } = useLanguage();
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

  // Resolve the "other party" for each duel (the duels table only stores
  // ids) so rows + the detail sheet can show a real @username instead of
  // the generic "Opponent" placeholder.
  const otherIds = useMemo(() => {
    const ids = new Set();
    duels.forEach((d) => {
      const otherId = d.challenger_id === user?.id ? d.opponent_id : d.challenger_id;
      if (otherId) ids.add(otherId);
    });
    return [...ids];
  }, [duels, user?.id]);

  const { data: profileMap = {} } = useQuery({
    queryKey: ['duelOpponents', otherIds],
    enabled: otherIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await selectProfiles((from) => from
        .select('id, username, avatar_url')
        .in('id', otherIds));
      const map = {};
      (data || []).forEach((p) => { map[p.id] = p; });
      return map;
    },
  });
  const opponentFor = (d) => profileMap[d.challenger_id === user?.id ? d.opponent_id : d.challenger_id] || null;

  const handleCancelDuel = async (id) => {
    try {
      await cancelDuel(id);
      qc.invalidateQueries({ queryKey: ['myDuels'] });
      setSelectedDuel(null);
      toast.success('Challenge cancelled.');
    } catch {
      toast.error(tFallback('marketplaceFeed.cancelFailed', 'Could not cancel. Try again.'));
    }
  };

  const active    = duels.filter(d => ['pending', 'active'].includes(d.status));
  const history   = duels.filter(d => ['completed', 'declined', 'expired'].includes(d.status));
  // Gate wins on `status === 'completed'` so an in-flight duel whose
  // winner_id was preemptively set (legacy submit fallback writes
  // winner_id on the first result before the second lands) doesn't
  // inflate the W column. The losses calc already required completed;
  // wins didn't and was asymmetric. (Audit 15 #L2.)
  const wins      = duels.filter(d => d.status === 'completed' && d.winner_id === user?.id).length;
  const losses    = duels.filter(d => d.status === 'completed' && d.winner_id && d.winner_id !== user?.id).length;

  return (
    <ErrorBoundary label="Duels">
    <div className="bg-background pb-6">
      {/* Header */}
      <div className="px-4 pt-6 pb-4">
        {/* Action buttons — lifted into their own row above the title so
            they have room to breathe. Full-width (flex-1) + larger. */}
        <div className="flex items-center gap-2 mb-4">
          <button
            onClick={() => setShowInviteLink(true)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-secondary text-foreground text-sm font-bold border border-border hover:bg-secondary/70 active:bg-secondary/70 transition-colors"
            aria-label={tFallback('duels.inviteByLink', 'Challenge someone by link')}
          >
            <LinkIcon className="w-4 h-4" />
            {tFallback('duels.inviteLink', 'Invite link')}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-primary text-primary-foreground text-sm font-bold hover:bg-primary/90 active:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {tFallback('duels.challenge', 'Challenge')}
          </button>
        </div>

        <div className="flex items-center gap-2 mb-1">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label={tFallback('common.back', 'Back')}
            className="-ms-1 w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground active:text-foreground hover:bg-secondary active:bg-secondary transition-colors"
          >
            <ArrowLeft className="w-5 h-5 rtl:scale-x-[-1]" />
          </button>
          <Swords className="w-5 h-5 text-primary" />
          <h1 className="text-xl font-black">{tFallback('duels.title', 'Duels')}</h1>
        </div>
        <p className="text-sm text-muted-foreground">{tFallback('duels.subtitle', 'Head-to-head workout battles')}</p>
      </div>

      {/* W/L record. Also surface for tie-only records so a user
          whose history is all draws still sees their participation
          stats. (Audit 15 #L1.) */}
      {(wins > 0 || losses > 0 || duels.some(d => d.status === 'completed' && !d.winner_id)) && (
        <div className="mx-4 mb-4 flex gap-3">
          <div className="flex-1 rounded-xl bg-primary/10 border border-primary/20 p-3 text-center">
            <p className="text-2xl font-black text-primary">{wins}</p>
            <p className="text-xs text-muted-foreground">{tFallback("duels.wins", "Wins")}</p>
          </div>
          <div className="flex-1 rounded-xl bg-rose-500/10 border border-rose-500/20 p-3 text-center">
            <p className="text-2xl font-black text-rose-500">{losses}</p>
            <p className="text-xs text-muted-foreground">{tFallback("duels.losses", "Losses")}</p>
          </div>
          <div className="flex-1 rounded-xl bg-secondary border border-border p-3 text-center">
            <p className="text-2xl font-black">{duels.filter(d => d.status === 'completed').length}</p>
            <p className="text-xs text-muted-foreground">{tFallback("duels.total", "Total")}</p>
          </div>
        </div>
      )}

      <div className="px-4 space-y-5">
        {/* Active / Pending */}
        {active.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{tFallback("duels.status.active", "Active")}</p>
            <div className="space-y-2">
              {active.map(d => (
                <DuelRow key={d.id} duel={d} currentUserId={user?.id} opponent={opponentFor(d)} onClick={() => setSelectedDuel(d)} />
              ))}
            </div>
          </div>
        )}

        {/* Completed / History */}
        {history.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{tFallback("hub.activity.completed", "Completed")}</p>
            <div className="space-y-2">
              {history.map(d => (
                <DuelRow key={d.id} duel={d} currentUserId={user?.id} opponent={opponentFor(d)} onClick={() => setSelectedDuel(d)} />
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && duels.length === 0 && (
          <div className="text-center py-16">
            <Swords className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="font-semibold text-muted-foreground">{tFallback("duels.noDuelsYet", "No duels yet")}</p>
            <p className="text-sm text-muted-foreground/60 mt-1">{tFallback("duels.challengeSomeoneFromTheirProfile", "Challenge someone from their profile")}</p>
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
            opponentProfile={opponentFor(selectedDuel)}
            onCancel={handleCancelDuel}
            onClose={() => setSelectedDuel(null)}
          />
        )}
      </AnimatePresence>
    </div>
    </ErrorBoundary>
  );
}
