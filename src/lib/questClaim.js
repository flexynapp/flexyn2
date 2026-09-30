// src/lib/questClaim.js
//
// Claiming a quest, with its feedback, from anywhere in the app.
//
// This was DailyQuestsCard's handleClaim / handleClaimResult / perfect-day
// code. It moved out when the completion cue went app-wide
// (QuestCompletionWatcher): the cue carries a Claim button on every page, and
// a Claim pressed on the Hub has to pay, report and refresh exactly as one
// pressed on Today does. The card keeps only what is its own, the XP figure
// that rises into its header.
//
// Every number reported here came back from the server. Nothing is computed
// on the client.

import { toast } from '@/lib/toast';
import { triggerHaptic } from '@/lib/haptic';
import * as quests from '@/lib/data/quests';
import * as notifications from '@/lib/data/notifications';
import { getQuestDefinition } from '@/lib/questCatalog';
import { reportError } from '@/lib/reportError';
import { clearProfile } from '@/api/profileCache';

/** The quest's display label in the current language. */
export function questLabel(questId, t) {
  const def = getQuestDefinition(questId);
  const k = `quest.${questId}.label`;
  const tl = t(k);
  return tl === k ? (def?.label || 'Quest') : tl;
}

// Confetti burst when all of the day's quests are claimed. Lazy-imports
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

function invalidateRewards(queryClient, user, crewXp) {
  // The claim moved coins AND total_xp on the server, and the RPC returns
  // no XP total to patch with. me() serves a module cache, so an invalidate
  // alone refetched the stale row: the level bar and the level-up overlay
  // never saw quest XP. Dropping the cache makes the refetch read the row.
  clearProfile();
  queryClient.invalidateQueries({ queryKey: ['dailyQuests'] });
  queryClient.invalidateQueries({ queryKey: ['questStats', user?.id] });
  queryClient.invalidateQueries({ queryKey: ['userProfile', user?.email] });
  // The coin balance also shows in the Coin Shop and the Stats Hub hero,
  // which read their own queries rather than userProfile.
  queryClient.invalidateQueries({ queryKey: ['coinShopProfile', user?.id] });
  queryClient.invalidateQueries({ queryKey: ['statsHubProfile', user?.id] });
  // The crew's own level moved if this fed it.
  if (crewXp > 0) queryClient.invalidateQueries({ queryKey: ['myCrews', user?.id] });
}

// Per-row in-flight guard, module-wide so the card's button and the pill's
// button cannot both claim the same row. claim_quest_atomic is idempotent on
// the server; this only stops the second tap flashing an error.
const claiming = new Set();

// Perfect day: asked after every claim that lands. Called speculatively — the
// RPC answers `not_complete` / `already_claimed` rather than raising, and its
// per-day idempotence is what guarantees one payment.
let bonusAsking = false;
async function askForPerfectDayBonus({ user, queryClient, tFallback }) {
  if (bonusAsking) return;
  bonusAsking = true;
  try {
    const bonus = await quests.claimPerfectDayBonus(user);
    if (!bonus.success) return;
    triggerHaptic('buzz');
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
    invalidateRewards(queryClient, user, bonus.crewXpAwarded);
  } catch (err) {
    reportError(err, { feature: 'dashboard.quest-perfect-day', level: 'warning', userEmail: user?.email });
  } finally {
    bonusAsking = false;
  }
}

/**
 * Claim a completed quest's reward and report it.
 *
 * @returns the RPC result on success, or null when nothing was claimed
 *          (already in flight, not complete, refused, or failed).
 */
export async function claimQuestWithFeedback({ user, row, t, tFallback, queryClient }) {
  if (!user?.id || !row?.id) return null;
  if (row.claimed_at || !row.completed_at) return null;
  if (claiming.has(row.id)) return null;
  claiming.add(row.id);
  try {
    const result = await quests.claimQuest(user, row.id);
    if (result?.reason === 'not_met') {
      // The server counts the quest from what was actually saved today and
      // came up short (an edit counted twice, a deleted entry, a second
      // device). Show its count and put the row back to it.
      await quests.resyncQuestProgress(row.id, result.progress);
      queryClient.invalidateQueries({ queryKey: ['dailyQuests'] });
      toast.error(tFallback('quests.notMetYet', 'Not done yet: {progress} of {target}', {
        progress: result.progress ?? 0, target: result.target ?? row.target,
      }), { id: `quest-${row.id}` });
      return null;
    }
    if (!result?.success) {
      toast.error(t('dashboard.claimError'));
      return null;
    }
    // Haptic after the RPC succeeds, so a failed claim never buzzes like a
    // reward.
    triggerHaptic('success');

    // One message, all three currencies. xpAwarded is what the daily quest
    // cap actually credited, not the catalog's nominal figure.
    const parts = [`+${result.coinsAwarded} ${tFallback('hub.coins', 'coins')}`];
    if (result.xpAwarded > 0) parts.push(`+${result.xpAwarded} XP`);
    toast.success(
      tFallback('dashboard.coinsClaimedToast', '+{coins} coins claimed!', { coins: result.coinsAwarded }),
      {
        // Same id as the completion cue, so the pill morphs from
        // "Quest complete" into the reward instead of stacking a second one.
        id: `quest-${row.id}`,
        icon: '🪙',
        description: result.crewXpAwarded > 0
          ? tFallback('quests.crewShareToast', '{rewards} · your crew banks {crewXp} XP', {
              rewards: parts.join(' · '), crewXp: result.crewXpAwarded,
            })
          : parts.join(' · '),
      },
    );
    invalidateRewards(queryClient, user, result.crewXpAwarded);

    // In-app notification, non-blocking.
    notifications.notifyQuestClaimed({
      user,
      questLabel: questLabel(row.quest_id, t),
      coinsAwarded: result.coinsAwarded,
      t,
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ['notificationsUnread', user?.id] }))
      .catch(err => reportError(err, {
        feature: 'dashboard.quest-claim-notification',
        level: 'warning',
        userEmail: user?.email,
      }));

    askForPerfectDayBonus({ user, queryClient, tFallback });
    return result;
  } catch (err) {
    reportError(err, {
      feature: 'dashboard.quest-claim',
      level: 'warning',
      userEmail: user?.email,
      questId: row.id,
    });
    toast.error(t('dashboard.claimError'));
    return null;
  } finally {
    claiming.delete(row.id);
  }
}
