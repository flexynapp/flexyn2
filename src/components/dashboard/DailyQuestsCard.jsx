// src/components/dashboard/DailyQuestsCard.jsx
//
// Renders today's quests on the Dashboard. Auto-creates them on mount
// (idempotent), polls for progress changes, and lets the user claim coin +
// XP rewards when quests complete. Tapping the header opens QuestsSheet —
// the full surface, in the shape ReadinessSheet uses.

import React, { useEffect, useRef, useState, Suspense } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Card } from '@/components/ui/card';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import FlexCoinIcon from '@/components/FlexCoinIcon';
import { toast } from '@/lib/toast';
import { triggerHaptic } from '@/lib/haptic';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as quests from '@/lib/data/quests';
import * as notifications from '@/lib/data/notifications';
import { getQuestDefinition, questDestinationRoute } from '@/lib/questCatalog';
import { QuestTile, QuestRewardLine } from '@/components/dashboard/questVisuals';
import { reportError } from '@/lib/reportError';

// Lazy — the sheet is a modal that only mounts on tap, per the lazy-loading
// rule in CLAUDE.md. It pulls in the stats RPC and the streak strip, none of
// which the resting card needs.
const QuestsSheet = React.lazy(() => import('@/components/dashboard/QuestsSheet'));

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
  // There was a collapse chevron here, and board 07 doesn't draw one. It
  // existed to buy back vertical space from a card that ran ~220px in a
  // 171px column; the card is ~150px on its own row now, so the control was
  // paying for a problem that no longer exists. The section is still
  // collapsible — and hideable — from edit mode, which is where every other
  // widget's version of this lives.
  const { user } = useAuth();
  const { t, tFallback } = useLanguage();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [sheetOpen, setSheetOpen] = useState(false);

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
    // ensureTodaysQuests already reads the day's full rows (or returns the
    // ones it just inserted), so its result IS the list. Reading the same
    // rows a second time doubled every 90s poll.
    queryFn: async () => quests.sortQuestRows(await quests.ensureTodaysQuests(user)),
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
    if (!result.success) {
      toast.error(t('dashboard.claimError'));
      return;
    }

    // One toast, all three currencies. Every number here came back from the
    // server — xpAwarded in particular is what the daily quest cap actually
    // credited, not the catalog's nominal figure, so a capped claim reports
    // the truth instead of promising 120 XP it didn't grant.
    const parts = [`+${result.coinsAwarded} ${tFallback('hub.coins', 'coins')}`];
    if (result.xpAwarded > 0) parts.push(`+${result.xpAwarded} XP`);
    toast.success(
      tFallback('dashboard.coinsClaimedToast', '+{coins} coins claimed!', { coins: result.coinsAwarded }),
      {
        icon: '🪙',
        description: result.crewXpAwarded > 0
          ? tFallback('quests.crewShareToast', '{rewards} · your crew banks {crewXp} XP', {
              rewards: parts.join(' · '), crewXp: result.crewXpAwarded,
            })
          : parts.join(' · '),
      }
    );
    queryClient.invalidateQueries({ queryKey: ['dailyQuests'] });
    queryClient.invalidateQueries({ queryKey: ['questStats', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
    // Also invalidate the coin-balance queries that surface in the
    // Coin Shop modal + Stats Hub hero — the previous list only
    // refreshed userProfile (which a few surfaces read) but missed
    // coinShopProfile + statsHubProfile, leaving stale balances
    // visible right after claim.
    queryClient.invalidateQueries({ queryKey: ['coinShopProfile', user?.id] });
    queryClient.invalidateQueries({ queryKey: ['statsHubProfile', user?.id] });
    // The crew's own level moved if this quest fed it — the crew card and
    // the crew list both read that number.
    if (result.crewXpAwarded > 0) {
      queryClient.invalidateQueries({ queryKey: ['myCrews', user?.id] });
    }
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
  };

  // Perfect day: fired after a claim lands, when every quest is claimed.
  // Called speculatively — the RPC answers `not_complete` / `already_claimed`
  // rather than raising, so the card doesn't need to prove the day is done
  // before asking. The ref stops a re-render from asking twice in a row; the
  // server's per-day idempotence is what actually guarantees one payment.
  const bonusAskedRef = useRef(false);
  const askForPerfectDayBonus = async () => {
    if (bonusAskedRef.current) return;
    bonusAskedRef.current = true;
    try {
      const bonus = await quests.claimPerfectDayBonus(user);
      if (!bonus.success) return;
      triggerHaptic('primary');
      fireAllQuestsConfetti();
      const extras = [`+${bonus.coinsAwarded} ${tFallback('hub.coins', 'coins')}`];
      if (bonus.xpAwarded > 0) extras.push(`+${bonus.xpAwarded} XP`);
      if (bonus.crewXpAwarded > 0) {
        extras.push(tFallback('quests.crewBanked', '{n} XP to your crew', { n: bonus.crewXpAwarded }));
      }
      toast.success(
        tFallback('quests.perfectDayToast', 'Perfect day, {n} day streak', { n: bonus.streak }),
        { icon: '🔥', description: extras.join(' · '), duration: 7000 },
      );
      queryClient.invalidateQueries({ queryKey: ['questStats', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
      queryClient.invalidateQueries({ queryKey: ['coinShopProfile', user?.id] });
      queryClient.invalidateQueries({ queryKey: ['statsHubProfile', user?.id] });
      if (bonus.crewXpAwarded > 0) {
        queryClient.invalidateQueries({ queryKey: ['myCrews', user?.id] });
      }
    } catch (err) {
      reportError(err, { feature: 'dashboard.quest-perfect-day', level: 'warning', userEmail: user?.email });
    } finally {
      // Re-arm. A failed or not-yet-eligible ask must be retryable when the
      // next claim lands, or a user who claims their last quest during a
      // network blip never gets the bonus that day.
      bonusAskedRef.current = false;
    }
  };

  // Completion effects: a top-of-screen "quest complete — tap to claim"
  // toast the moment a quest crosses into completed, and the perfect-day
  // bonus when every quest is claimed. Refs seed on first render so we
  // don't retroactively fire for quests already completed earlier today.
  const hydratedRef = useRef(false);
  const announcedRef = useRef(new Set());
  const allClaimedRef = useRef(false);
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const total = rows.length;
    const claimedCount = rows.filter((r) => r.claimed_at).length;

    if (!hydratedRef.current) {
      hydratedRef.current = true;
      rows.forEach((r) => { if (r.completed_at) announcedRef.current.add(r.id); });
      if (total > 0 && claimedCount === total) allClaimedRef.current = true;
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

    // The celebration hangs off CLAIMED, not completed. It used to fire when
    // the last quest crossed into complete — which is one tap before the day
    // is actually finished, so the confetti landed while a Claim button was
    // still sitting there unpressed.
    if (total > 0 && claimedCount === total && !allClaimedRef.current) {
      allClaimedRef.current = true;
      askForPerfectDayBonus();
    }
    if (claimedCount < total) allClaimedRef.current = false;
    // Keyed on `rows` — the meaningful trigger. handleClaim/t are captured
    // from the render where rows changed, which is current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  if (!user?.id || rows.length === 0) return null;

  // Drop rows missing a stable id too — the map(key={q.id}) below
  // would collide on `undefined` keys if multiple corrupt rows slip
  // through and we'd lose state on the duplicates.
  // Order comes from listTodaysQuests (difficultyRank: easy → hard → crew);
  // annotate preserves it.
  const annotated = rows
    .map(quests.annotateQuest)
    .filter(q => q && q.definition && q.id);

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
      {/* Board 07: a 14px circle-check, the title, and the count pushed to
          the card's right padding edge. The count used to sit tight against
          the title, which read as part of it ("Daily Quests 0/3") rather than
          as the day's score. The claimable pill isn't in the drawing — it has
          nothing to show in a resting state — so it takes the slot before the
          count and the drawn layout is what you see when nothing is ready.

          The whole row is the button into the sheet. A separate "see all"
          control would be a second tap target on a 36px row for a card whose
          header is already the only non-quest thing in it. */}
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="w-full flex items-center gap-2 mb-3 flex-wrap text-start -mx-1 px-1 py-0.5 rounded-lg hover:bg-secondary/25 active:bg-secondary/40 transition-colors"
      >
        <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
        <h3 className="font-heading font-bold text-sm tracking-tight truncate">{t('dashboard.dailyQuests')}</h3>
        {claimableCoins > 0 && (
          <motion.div
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 text-primary text-micro font-bold"
          >
            <FlexCoinIcon size={12} />
            +{claimableCoins} {t('dashboard.ready')}
          </motion.div>
        )}
        <span className="ms-auto flex items-center gap-0.5 text-micro text-muted-foreground tabular-nums shrink-0">
          {completedCount} / {annotated.length}
          <ChevronRight className="w-3.5 h-3.5 rtl:scale-x-[-1]" aria-hidden="true" />
        </span>
      </button>

      {/* 4px between rows, not 8. Board 07 runs them on a 36px pitch: a 28px
          tile against a 30px two-line text block, four apart. */}
      <div className="space-y-1">
        {annotated.map((q) => (
          <QuestRow
            key={q.id}
            quest={q}
            onClaim={() => handleClaim(q)}
            onGo={() => goToQuest(q)}
            onOpenSheet={() => setSheetOpen(true)}
            t={t}
            tFallback={tFallback}
          />
        ))}
      </div>

      {claimedCount === annotated.length && (
        <div className="mt-3 text-micro text-center text-muted-foreground">
          {t('dashboard.allQuestsClaimed')}
        </div>
      )}

      {sheetOpen && (
        <Suspense fallback={null}>
          <QuestsSheet
            open
            onClose={() => setSheetOpen(false)}
            quests={annotated}
            onClaim={handleClaim}
            onGo={(q) => { setSheetOpen(false); goToQuest(q); }}
          />
        </Suspense>
      )}
    </Card>
  );
}

/**
 * A quest row is TWO tap targets, and which half you hit decides what happens.
 *
 *   [ tile · title · reward line ][ ......... ][ ✓ / Claim ]
 *   └─────── go to the quest ────┘└─── open the quests sheet ───┘
 *
 * It used to be one: the whole row navigated. That made the sheet nearly
 * unreachable, because the only other way in is the card header — a 20px strip
 * at the very top of the card — and every other pixel of a four-row card sent
 * you to another page instead. You had to aim.
 *
 * The empty middle is the reason this is a layout change and not just an
 * onClick move. The text block was `flex-1`, so it stretched across all the
 * spare width and that apparently-blank grey gap was still the navigate
 * target. Now the text block sizes to its content and a separate spacer owns
 * the gap, which is what makes "tap the grey space" mean the sheet.
 *
 * `min-w-0` on both the nav zone and the text block is load-bearing: it is
 * what lets a long title shrink below its intrinsic width so `truncate` can
 * ellipsis it. Without it a long quest name would push the trailing control
 * off the row.
 */
// Exported for questRowZones.test.jsx. The two-zone split is a layout
// contract, not just a handler arrangement, and testing it against the real
// row rather than a reproduction is the only way the test can catch someone
// putting `flex-1` back on the text block.
export function QuestRow({ quest, onClaim, onGo, onOpenSheet, t, tFallback }) {
  if (!quest || !quest.definition) return null;
  const def = quest.definition;
  const completed = !!quest.completed_at;
  const claimed = !!quest.claimed_at;
  // The percentage that used to drive a background fill is gone with it —
  // board 07 states progress as the fraction and nothing else. That also
  // retires the quest.target=0 guard it needed (a corrupt seed row made the
  // bare division Infinity, or NaN when both were 0, and rendered an invalid
  // `width: NaN%`); the fraction prints those values honestly instead.
  // Look up translated quest copy via the catalog convention `quest.<id>.label/desc`.
  // Falls back to the English label/desc baked into the catalog if the key is
  // missing in the current language.
  const label = (() => { const k = `quest.${def.id}.label`; const v = t(k); return v === k ? def.label : v; })();

  // Claimed quests are read-only — there is nowhere useful to send someone for
  // a quest they have already finished and banked.
  const canGo = !claimed && !!onGo;

  return (
    <motion.div
      layout
      onClick={onOpenSheet}
      // Deliberately no role / tabIndex here. Nesting a button inside a button
      // is invalid, and every action on this row is already keyboard-reachable
      // without it: the nav zone below is a real control, Claim is a real
      // button, and the card header opens this same sheet. This handler is a
      // POINTER affordance — "tap anywhere spare to see the whole thing" —
      // rather than a second keyboard stop that would just add noise to the
      // tab order.
      //
      // Board 07 draws a quest as a tile, a title and a progress line sitting
      // on the card's own surface. No border, no fill, no per-row card — the
      // bordered row this replaces was a card inside a card (banned outright
      // in CLAUDE.md) and is most of why three quests needed ~220px to say
      // three things. Press feedback survives as a tint rather than a border;
      // -mx-1 px-1 lets that tint sit a little wider than the text instead of
      // indenting every row to make room for it.
      className="relative flex items-center gap-2.5 rounded-lg -mx-1 px-1 cursor-pointer active:bg-secondary/20 transition-colors"
    >
      {/* ── Zone 1: go to the quest ──────────────────────────────────────
          Hugs its content so the spare width beside it belongs to the sheet.
          Claimed rows keep the same box for alignment but drop the handler,
          so tapping a finished quest falls through to the sheet like the
          rest of the row. */}
      <div
        role={canGo ? 'button' : undefined}
        tabIndex={canGo ? 0 : undefined}
        aria-label={canGo ? tFallback('quests.goTo', 'Go to: {label}', { label }) : undefined}
        onClick={canGo ? (e) => { e.stopPropagation(); onGo(); } : undefined}
        onKeyDown={canGo ? (e) => {
          // Gate on currentTarget so Enter on the Claim button — which is a
          // focusable descendant when the quest is complete — doesn't also
          // navigate away mid-claim.
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo(); }
        } : undefined}
        className={`flex items-center gap-2.5 min-w-0 rounded-lg ${
          canGo ? 'cursor-pointer hover:bg-secondary/30 active:bg-secondary/45 transition-colors' : ''
        }`}
      >
        <QuestTile icon={def.icon} completed={completed} claimed={claimed} />

        <div className="min-w-0">
          {/* cq-clamp2 stays even though this row is full-width by default:
              the rules behind it only fire inside a .dash-slot under 250px, so
              it costs nothing here and still catches a user who pairs quests
              with something by hand in edit mode. */}
          {/* leading-tight, not the default 20px line box: the drawing gives the
              title 16px and the progress line 14px, which is what puts the row
              on a 36px pitch. text-sm's default leading alone added 4px a row. */}
          <p className={`font-medium text-sm leading-tight truncate cq-clamp2 ${claimed ? 'text-muted-foreground line-through decoration-1' : ''}`}>
            {label}
          </p>
          <QuestRewardLine
            quest={quest}
            tFallback={tFallback}
            className="block text-micro text-muted-foreground"
          />
        </div>
      </div>

      {/* ── Zone 2: the grey space ───────────────────────────────────────
          Takes every pixel the text doesn't, and self-stretch makes it the
          full row height so the target is the whole gap rather than a thin
          band on the text's baseline. Clicks fall through to the row's
          onClick, which opens the sheet. */}
      <div className="flex-1 self-stretch" aria-hidden="true" />

      <AnimatePresence mode="wait">
        {claimed ? (
          // Claimed keeps a mark at the end of the row, but it is now the
          // quiet one: the loud green tile at the START of the row is what
          // says done, and repeating it here in the same weight would give
          // the row two focal points.
          // No handler: a tap here falls through to the row and opens the
          // sheet, which is what this mark should do. It is a status glyph,
          // not a control — there is nothing left to claim on a claimed
          // quest, so sending someone to the full view is the only sensible
          // thing a tap on it can mean.
          <motion.div
            key="claimed"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="flex items-center gap-1 text-success text-xs py-1.5 ps-1.5"
          >
            <CheckCircle2 className="w-4 h-4" />
          </motion.div>
        ) : completed ? (
          <motion.button
            key="claim"
            initial={{ scale: 0.85, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            whileTap={{ scale: 0.94 }}
            onClick={(e) => { e.stopPropagation(); onClaim(); }}
            // hover:brightness, not hover:opacity with transition-opacity:
            // framer writes this button's opacity inline for its entrance,
            // and a CSS transition on the same property smears it (see
            // lib/listMotion.js). The press is framer's whileTap.
            className="px-3 py-1 rounded-sm bg-primary text-primary-foreground text-xs font-bold hover:brightness-110"
          >
            {t('dashboard.claim')}
          </motion.button>
        ) : null}
      </AnimatePresence>
    </motion.div>
  );
}
