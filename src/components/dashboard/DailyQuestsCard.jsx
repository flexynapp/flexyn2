// src/components/dashboard/DailyQuestsCard.jsx
//
// Renders today's three quests on the Dashboard. Auto-creates them on mount
// (idempotent), polls for progress changes, and lets the user claim coin
// rewards when quests complete.

import React, { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import {
  Coins, Sparkles, CheckCircle2, ChevronUp, ChevronDown,
  UtensilsCrossed, Droplet, Dumbbell, HeartPulse, Megaphone, Bike,
  Camera, Flame, Trophy, Zap, Target,
} from 'lucide-react';
import { toast } from '@/lib/toast';
import { triggerHaptic } from '@/lib/haptic';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as quests from '@/lib/data/quests';
import * as notifications from '@/lib/data/notifications';
import { getQuestDefinition, QUEST_DIFFICULTY, questDestinationRoute } from '@/lib/questCatalog';
import { reportError } from '@/lib/reportError';

// questCatalog stores `icon` as a lucide export NAME so that module stays
// free of React imports (it's also read by lib/data/quests.js and the
// server-mirroring tests). Resolution happens here, at the only place that
// renders a quest row. Explicit map rather than a dynamic lookup on the
// lucide namespace so tree-shaking can still drop everything unused, and
// so a typo in the catalog fails loudly in review rather than silently
// rendering nothing.
const QUEST_ICONS = {
  UtensilsCrossed, Droplet, Dumbbell, HeartPulse, Megaphone, Bike,
  Camera, Flame, Trophy, Zap, Target,
};

// Confetti burst when all of the day's quests are complete. Lazy-imports
// canvas-confetti (its own chunk) and honors reduced-motion.
function fireAllQuestsConfetti() {
  if (typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const colors = ['#f97316', '#fb923c', '#fbbf24', '#22c55e', '#ffffff'];
  import('canvas-confetti').then(({ default: confetti }) => {
    confetti({ particleCount: 130, spread: 100, origin: { x: 0.5, y: 0.5 }, colors });
    setTimeout(() => confetti({ particleCount: 80, spread: 75, origin: { x: 0.15, y: 0.5 }, colors }), 120);
    setTimeout(() => confetti({ particleCount: 80, spread: 75, origin: { x: 0.85, y: 0.5 }, colors }), 240);
  }).catch(() => {});
}

export default function DailyQuestsCard({ onNavigated }) {
  // Collapsible quest list — chevron at the bottom flips between
  // "expanded" (default) and "collapsed". When collapsed only the
  // header row stays on screen (Sparkles + "Daily Quests" + count
  // + claimable badge), which saves a chunk of vertical space on a
  // tight phone screen. State is per-session so it doesn't carry
  // across days.
  const [collapsed, setCollapsed] = useState(false);
  const { user } = useAuth();
  const { t, tFallback } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Navigate to the page where this quest can be completed. Notifies the
  // parent (e.g. StatsHubModal) so it can close itself first — otherwise
  // the modal stays mounted and intercepts the new page's UI.
  const goToQuest = (questRow) => {
    const route = questDestinationRoute(questRow.quest_id);
    if (!route) {
      // Surface a toast when we have no destination — previously the
      // tap was a silent no-op and the user couldn't tell whether the
      // row was tappable. Catalog drift (new quest_id in DB but no
      // route in questCatalog.js) is the common cause.
      toast.info(tFallback('dashboard.questNoRoute', "Open the app's main pages to make progress on this quest."));
      return;
    }
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

  // Reward cue for a just-claimed quest: { id, coins }. The app-wide toast
  // policy (src/lib/toast.js) suppresses every non-error toast that doesn't
  // carry an `action`, so the old `toast.success('+N coins claimed!')` here
  // rendered NOTHING — the coins landed and the balance moved, but the
  // reward moment itself was invisible. That policy exists to stop toasts
  // obstructing the view "until we ship subtle completion cues", so this is
  // that cue rather than a fake action bolted on to defeat the policy.
  const [claimFx, setClaimFx] = useState(null);
  const claimFxTimer = useRef(null);
  useEffect(() => () => clearTimeout(claimFxTimer.current), []);

  const handleClaim = async (questRow) => {
    if (questRow.claimed_at) return;
    if (!questRow.completed_at) return;
    if (claimingRef.current.has(questRow.id)) return; // already claiming this row
    claimingRef.current.add(questRow.id);
    try {
      const result = await quests.claimQuest(user, questRow.id);
      // Fire haptic AFTER the RPC succeeds, not before — the previous
      // order vibrated the device on tap regardless of outcome, so a
      // failed claim still buzzed and felt like a successful reward.
      if (result?.success) triggerHaptic('primary');
      await handleClaimResult(result, questRow);
    } catch (err) {
      // Catch the promise rejection so a network blip or RPC throw
      // doesn't surface as an unhandled-rejection in the console
      // (which then becomes a Sentry noise event with no context).
      // The user toast keeps the error visible; reportError tags it
      // with feature + quest id for ops.
      reportError(err, {
        feature: 'dashboard.quest-claim',
        level: 'warning',
        userEmail: user?.email,
        questId: questRow.id,
      });
      toast.error(t('dashboard.claimError'));
    } finally {
      claimingRef.current.delete(questRow.id);
    }
  };

  const handleClaimResult = async (result, questRow) => {
    if (result.success) {
      // tFallback handles placeholder substitution + missing-key fallback
       // in one call — the prior `t('...').replace('{coins}', ...)` left the
       // raw key visible when the language file didn't have the entry,
       // and the substitution silently no-op'd when the translator used a
       // different placeholder name. (Audit 08 #M-1.)
      // Float a "+N 🪙" off the claimed row and announce the same string to
      // screen readers (which got nothing at all from the suppressed toast).
      setClaimFx({ id: questRow.id, coins: result.coinsAwarded });
      clearTimeout(claimFxTimer.current);
      claimFxTimer.current = setTimeout(() => setClaimFx(null), 1600);
      queryClient.invalidateQueries({ queryKey: ['dailyQuests'] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      // Also invalidate the coin-balance queries that surface in the
      // Coin Shop modal + Stats Hub hero — the previous list only
      // refreshed userProfile (which a few surfaces read) but missed
      // coinShopProfile + statsHubProfile, leaving stale balances
      // visible right after claim.
      queryClient.invalidateQueries({ queryKey: ['coinShopProfile', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['statsHubProfile', user?.id] });
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

  // Completion effects: a top-of-screen "quest complete — tap to claim"
  // toast the moment a quest crosses into completed, and a confetti burst
  // when ALL of the day's quests are done. Refs seed on first render so we
  // don't retroactively fire for quests already completed earlier today.
  const hydratedRef = useRef(false);
  const announcedRef = useRef(new Set());
  const allDoneRef = useRef(false);
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const total = rows.length;
    const completeCount = rows.filter((r) => r.completed_at).length;

    if (!hydratedRef.current) {
      hydratedRef.current = true;
      rows.forEach((r) => { if (r.completed_at) announcedRef.current.add(r.id); });
      if (total > 0 && completeCount === total) allDoneRef.current = true;
      return;
    }

    rows.forEach((r) => {
      if (!r.completed_at || announcedRef.current.has(r.id)) return;
      announcedRef.current.add(r.id);
      if (r.claimed_at) return; // already claimed elsewhere — no prompt
      const def = getQuestDefinition(r.quest_id);
      const k = `quest.${r.quest_id}.label`;
      const tl = t(k);
      const label = tl === k ? (def?.label || 'Quest') : tl;
      triggerHaptic('primary');
      toast.success(
        tFallback('dashboard.questCompleteToast', 'Quest complete: {label}', { label }),
        {
          icon: '🎯',
          description: tFallback('dashboard.questCompleteClaimHint', 'Tap to claim your reward'),
          duration: 8000,
          action: { label: t('dashboard.claim'), onClick: () => handleClaim(r) },
        },
      );
    });

    if (total > 0 && completeCount === total && !allDoneRef.current) {
      allDoneRef.current = true;
      triggerHaptic('primary');
      fireAllQuestsConfetti();
      toast.success(tFallback('dashboard.allQuestsCompleteToast', 'All daily quests complete! 🎉'), { duration: 6000 });
    }
    // Keyed on `rows` — the meaningful trigger. handleClaim/t are captured
    // from the render where rows changed, which is current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  if (!user?.id || rows.length === 0) return null;

  // Drop rows missing a stable id too — the map(key={q.id}) below
  // would collide on `undefined` keys if multiple corrupt rows slip
  // through and we'd lose state on the duplicates.
  const annotated = rows
    .map(quests.annotateQuest)
    .filter(q => q && q.definition && q.id);
  // Sort easy → medium → hard. Default unknown difficulties to a high
  // index so an unmapped value lands at the bottom rather than
  // producing NaN comparisons (NaN-NaN=NaN, V8 sort surfaces quests
  // in random order on each render).
  const sortOrder = { easy: 0, medium: 1, hard: 2 };
  annotated.sort((a, b) => {
    const ai = sortOrder[a.difficulty] ?? 99;
    const bi = sortOrder[b.difficulty] ?? 99;
    return ai - bi;
  });

  const completedCount = annotated.filter(q => q.completed_at).length;
  const claimedCount = annotated.filter(q => q.claimed_at).length;
  const claimableCoins = annotated
    .filter(q => q.completed_at && !q.claimed_at)
    .reduce((sum, q) => sum + q.coin_reward, 0);

  // Was an orange-tinted gradient card. Same reasoning as the recovery
  // section in Dashboard.jsx — sections separate by spacing and type,
  // not by each owning a hue.
  return (
    <Card className="p-4 md:p-5">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-4 h-4 text-primary shrink-0" />
          <h3 className="font-heading font-bold text-sm tracking-tight truncate">{t('dashboard.dailyQuests')}</h3>
          <span className="text-micro text-muted-foreground tabular-nums shrink-0">
            {completedCount}/{annotated.length}
          </span>
        </div>
        {claimableCoins > 0 && (
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-micro font-bold"
          >
            <Coins className="w-3 h-3" />
            +{claimableCoins} {t('dashboard.ready')}
          </motion.div>
        )}
      </div>

      {!collapsed && (
        <div className="space-y-2">
          {annotated.map((q) => (
            <QuestRow
              key={q.id}
              quest={q}
              justClaimedCoins={claimFx?.id === q.id ? claimFx.coins : null}
              onClaim={() => handleClaim(q)}
              onGo={() => goToQuest(q)}
              t={t}
              tFallback={tFallback}
            />
          ))}
        </div>
      )}

      {/* Screen readers got nothing from the suppressed toast. Announce the
          claim with the same string the toast used to carry. */}
      <div className="sr-only" role="status" aria-live="polite">
        {claimFx
          ? tFallback('dashboard.coinsClaimedToast', '+{coins} coins claimed!', { coins: claimFx.coins })
          : ''}
      </div>

      {!collapsed && claimedCount === annotated.length && (
        <div className="mt-3 text-micro text-center text-muted-foreground">
          {t('dashboard.allQuestsClaimed')}
        </div>
      )}

      <button
        type="button"
        onClick={() => setCollapsed(c => !c)}
        aria-label={collapsed ? tFallback('dashboard.expandQuests', 'Expand quests') : tFallback('dashboard.collapseQuests', 'Collapse quests')}
        aria-expanded={!collapsed}
        className="w-full mt-2 -mb-1 flex items-center justify-center py-1 rounded-sm text-muted-foreground/60 hover:text-foreground active:text-foreground hover:bg-secondary/40 active:bg-secondary/60 transition-colors"
      >
        {collapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
      </button>
    </Card>
  );
}

function QuestRow({ quest, justClaimedCoins = null, onClaim, onGo, t, tFallback }) {
  if (!quest || !quest.definition) return null;
  const def = quest.definition;
  const completed = !!quest.completed_at;
  const claimed = !!quest.claimed_at;
  // Guard quest.target=0 (corrupt seed row) — the bare division would
  // produce Infinity that clamps to 100% on a zero-progress quest, or
  // NaN when both are 0, which renders as invalid `width: NaN%`.
  const target = Number(quest.target) || 0;
  const progress = Number(quest.progress) || 0;
  const progressPct = target > 0
    ? Math.min(100, Math.max(0, Math.round((progress / target) * 100)))
    : 0;
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
      onKeyDown={tappable ? (e) => {
        // Gate on currentTarget — inner Claim button (when completed)
        // is focusable, and Enter on it would otherwise also fire onGo
        // via bubbling, navigating away from the page mid-claim.
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(); }
      } : undefined}
      className={`relative rounded-lg bg-card border border-border/50 p-3 overflow-hidden ${tappable ? 'cursor-pointer hover:border-border transition-colors' : ''}`}
    >
      {/* Subtle progress bar fill in background.
          `diffMeta.color` is a bare `var(--x)` reference, so alpha is
          composed with hsl()'s slash syntax. It used to be a raw hex and
          this appended '26' / '10' as hex alpha — that string concat
          silently produces invalid CSS the moment the value stops being a
          6-digit hex, which is exactly what happened when difficulty
          colours moved onto tokens. */}
      <div
        className="absolute inset-0 transition-[width] duration-500"
        style={{
          width: `${progressPct}%`,
          background: `linear-gradient(90deg, hsl(${diffMeta.color} / 0.18), hsl(${diffMeta.color} / 0.06))`,
        }}
        aria-hidden="true"
      />

      {/* Reward cue — rises and fades where the Claim button just was. The
          row is overflow-hidden, so the travel stays inside its bounds.
          aria-hidden: the card announces this via its own live region. */}
      <AnimatePresence>
        {justClaimedCoins != null && (
          <motion.div
            key="claim-fx"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: -8 }}
            exit={{ opacity: 0, y: -16 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            aria-hidden="true"
            className="absolute end-3 top-1/2 -translate-y-1/2 z-10 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-primary-foreground text-micro font-bold tabular-nums pointer-events-none"
          >
            <Coins className="w-3 h-3" />
            +{justClaimedCoins}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative flex items-center gap-3">
        {/* Was a 24px emoji. The tile takes the difficulty accent, which
            the emoji could never do — colour now carries "how hard is
            this" on the icon as well as the pill. */}
        <div
          className="shrink-0 w-9 h-9 rounded-sm flex items-center justify-center"
          style={{ backgroundColor: `hsl(${diffMeta.color})`, color: 'white' }}
          aria-hidden="true"
        >
          {(() => {
            const QuestIcon = QUEST_ICONS[def.icon] || Sparkles;
            return <QuestIcon className="w-4 h-4" />;
          })()}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="font-medium text-sm truncate">{label}</p>
            {/* Difficulty label is plain muted text. The solid icon tile to
                the left already carries the difficulty colour, so tinting
                this too was saying it twice — and `--destructive` measures
                3.48:1 against the dark card, which fails AA for an 11px
                label. Muted-foreground clears it at 5.4:1 in both themes. */}
            <span className="text-micro font-bold uppercase tracking-wider text-muted-foreground shrink-0">
              {t(`quest.difficulty.${quest.difficulty}`)}
            </span>
          </div>
          <p className="text-micro text-muted-foreground tabular-nums">
            {quest.progress}/{quest.target} · {quest.coin_reward} {tFallback('hub.coins', 'coins')}
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
              className="px-3 py-1 rounded-sm bg-primary text-primary-foreground text-xs font-bold hover:opacity-90 transition-opacity"
            >
              {t('dashboard.claim')}
            </motion.button>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
