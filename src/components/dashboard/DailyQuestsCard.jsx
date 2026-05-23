// src/components/dashboard/DailyQuestsCard.jsx
//
// Renders today's three quests on the Dashboard. Auto-creates them on mount
// (idempotent), polls for progress changes, and lets the user claim coin
// rewards when quests complete.

import React, { useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { Coins, Sparkles, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { triggerHaptic } from '@/lib/haptic';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as quests from '@/lib/data/quests';
import * as notifications from '@/lib/data/notifications';
import { getQuestDefinition, QUEST_DIFFICULTY, questDestinationRoute } from '@/lib/questCatalog';
import { reportError } from '@/lib/reportError';

export default function DailyQuestsCard({ onNavigated }) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Navigate to the page where this quest can be completed. Notifies the
  // parent (e.g. StatsHubModal) so it can close itself first — otherwise
  // the modal stays mounted and intercepts the new page's UI.
  const goToQuest = (questRow) => {
    const route = questDestinationRoute(questRow.quest_id);
    if (!route) return;
    onNavigated?.();
    navigate(route);
  };

  // Ensure today's quests exist on mount, then read them.
  const { data: rows = [] } = useQuery({
    queryKey: ['dailyQuests', user?.id, quests.todayDateString()],
    queryFn: async () => {
      await quests.ensureTodaysQuests(user);
      return quests.listTodaysQuests(user);
    },
    enabled: !!user?.id,
    // Quest progress also invalidates on action (workout save, meal log, etc.)
    // so we don't need to poll aggressively. 90s is fine for the rare async
    // bump case while saving battery on mobile.
    refetchInterval: 90_000,
    refetchOnWindowFocus: true,
  });

  // We previously ran a setInterval(refetch, 60s) to handle the midnight
  // rollover case. That was a duplicate signal — useQuery already polls
  // at refetchInterval: 90_000 AND refetches on window focus, both of
  // which cover the same case AND honor visibility (so a backgrounded
  // PWA isn't burning battery + Supabase reads). Removed entirely. If a
  // future midnight-precision case appears, gate it on
  // `document.visibilityState === 'visible'`.

  // Per-quest in-flight guard. claim_quest_atomic IS server-side
  // idempotent (the second call returns success=false with
  // already_claimed=true), but a rapid double-tap would still flash
  // an error toast on the second click. Using a Set in a ref so we
  // don't trigger a re-render on every claim — just block the
  // duplicate before it leaves the client.
  const claimingRef = useRef(new Set());

  const handleClaim = async (questRow) => {
    if (questRow.claimed_at) return;
    if (!questRow.completed_at) return;
    if (claimingRef.current.has(questRow.id)) return; // already claiming this row
    claimingRef.current.add(questRow.id);
    triggerHaptic('primary');
    try {
      const result = await quests.claimQuest(user, questRow.id);
      await handleClaimResult(result, questRow);
    } finally {
      claimingRef.current.delete(questRow.id);
    }
  };

  const handleClaimResult = async (result, questRow) => {
    if (result.success) {
      toast.success(t('dashboard.coinsClaimedToast').replace('{coins}', result.coinsAwarded), { icon: '🪙' });
      queryClient.invalidateQueries({ queryKey: ['dailyQuests'] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      // In-app notification — non-blocking
      const def = getQuestDefinition(questRow.quest_id);
      const labelKey = `quest.${questRow.quest_id}.label`;
      const translatedLabel = t(labelKey);
      const label = translatedLabel === labelKey ? (def?.label || 'Quest') : translatedLabel;
      notifications.notifyQuestClaimed({
        user,
        questLabel: label,
        coinsAwarded: result.coinsAwarded,
        t,
      })
        .then(() => queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] }))
        .catch(err => reportError(err, {
          feature: 'dashboard.quest-claim-notification',
          level: 'warning',
          userEmail: user?.email,
        }));
    } else {
      toast.error(t('dashboard.claimError'));
    }
  };

  if (!user?.id || rows.length === 0) return null;

  const annotated = rows.map(quests.annotateQuest).filter(q => q.definition);
  // Sort easy → medium → hard
  const sortOrder = { easy: 0, medium: 1, hard: 2 };
  annotated.sort((a, b) => sortOrder[a.difficulty] - sortOrder[b.difficulty]);

  const completedCount = annotated.filter(q => q.completed_at).length;
  const claimedCount = annotated.filter(q => q.claimed_at).length;
  const claimableCoins = annotated
    .filter(q => q.completed_at && !q.claimed_at)
    .reduce((sum, q) => sum + q.coin_reward, 0);

  return (
    <Card className="p-4 md:p-5 bg-gradient-to-br from-card to-secondary/30 border-border/60 theme-card-accent">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-primary" />
          <h3 className="font-heading font-bold text-sm tracking-tight">{t('dashboard.dailyQuests')}</h3>
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {completedCount}/{annotated.length}
          </span>
        </div>
        {claimableCoins > 0 && (
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-[11px] font-bold"
          >
            <Coins className="w-3 h-3" />
            +{claimableCoins} {t('dashboard.ready')}
          </motion.div>
        )}
      </div>

      <div className="space-y-2">
        {annotated.map((q) => (
          <QuestRow
            key={q.id}
            quest={q}
            onClaim={() => handleClaim(q)}
            onGo={() => goToQuest(q)}
            t={t}
          />
        ))}
      </div>

      {claimedCount === annotated.length && (
        <div className="mt-3 text-[11px] text-center text-muted-foreground">
          {t('dashboard.allQuestsClaimed')}
        </div>
      )}
    </Card>
  );
}

function QuestRow({ quest, onClaim, onGo, t }) {
  const def = quest.definition;
  const completed = !!quest.completed_at;
  const claimed = !!quest.claimed_at;
  const progressPct = Math.min(100, Math.round((quest.progress / quest.target) * 100));
  const diffMeta = QUEST_DIFFICULTY[quest.difficulty];
  // Look up translated quest copy via the catalog convention `quest.<id>.label/desc`.
  // Falls back to the English label/desc baked into the catalog if the key is
  // missing in the current language.
  const label = (() => { const k = `quest.${def.id}.label`; const v = t(k); return v === k ? def.label : v; })();

  // Claimed quests are read-only; in-progress and ready-to-claim are tappable
  // to deep-link the user to where they can complete (or claim) the quest.
  const tappable = !claimed && onGo;

  return (
    <motion.div
      layout
      role={tappable ? 'button' : undefined}
      tabIndex={tappable ? 0 : undefined}
      onClick={tappable ? onGo : undefined}
      onKeyDown={tappable ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(); } } : undefined}
      className={`relative rounded-lg bg-background/60 border border-border/50 p-3 overflow-hidden ${tappable ? 'cursor-pointer hover:border-border transition-colors' : ''}`}
    >
      {/* Subtle progress bar fill in background */}
      <div
        className="absolute inset-0 transition-[width] duration-500"
        style={{
          width: `${progressPct}%`,
          background: `linear-gradient(90deg, ${diffMeta.color}26, ${diffMeta.color}10)`,
        }}
        aria-hidden="true"
      />

      <div className="relative flex items-center gap-3">
        <div className="text-2xl shrink-0" aria-hidden="true">{def.icon}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-sm truncate">{label}</p>
            <span
              className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
              style={{ background: `${diffMeta.color}22`, color: diffMeta.color }}
            >
              {t(`quest.difficulty.${quest.difficulty}`)}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {quest.progress}/{quest.target} · {quest.coin_reward} {t('hub.coins') !== 'hub.coins' ? t('hub.coins') : 'coins'}
          </p>
        </div>

        <AnimatePresence mode="wait">
          {claimed ? (
            <motion.div
              key="claimed"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="flex items-center gap-1 text-muted-foreground text-xs"
            >
              <CheckCircle2 className="w-4 h-4" />
            </motion.div>
          ) : completed ? (
            <motion.button
              key="claim"
              initial={{ scale: 0.85, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              onClick={(e) => { e.stopPropagation(); onClaim(); }}
              className="px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity"
            >
              {t('dashboard.claim')}
            </motion.button>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
