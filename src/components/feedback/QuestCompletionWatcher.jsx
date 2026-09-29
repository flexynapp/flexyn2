// src/components/feedback/QuestCompletionWatcher.jsx
//
// The "quest complete" cue, on every page. Mounted once in App beside the
// feedback pill, and renders nothing itself: it listens for completions
// (lib/questCompletion.js) and shows each one in the pill, with a Claim button
// that pays out exactly as the Today card's does (lib/questClaim.js).
//
// It used to live inside DailyQuestsCard, which is on Today only, so a quest
// finished on the Hub stayed silent until the user went back to Today.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { subscribeQuestCompleted } from '@/lib/questCompletion';
import { claimQuestWithFeedback, questLabel } from '@/lib/questClaim';

export default function QuestCompletionWatcher() {
  const { user } = useAuth();
  const { t, tFallback } = useLanguage();
  const queryClient = useQueryClient();

  // The subscription lives for the app's lifetime; the latest user and
  // translators are read through a ref so a language switch or a profile
  // refresh does not resubscribe (which would be harmless, but pointless).
  const ctx = useRef({ user, t, tFallback, queryClient });
  ctx.current = { user, t, tFallback, queryClient };

  useEffect(() => subscribeQuestCompleted((row) => {
    const { user: u, t: tt, tFallback: tf, queryClient: qc } = ctx.current;
    if (!u?.id || (row.user_id && row.user_id !== u.id)) return;
    // Anything showing quests (Today's card, the Stats Hub, the sheet) should
    // show the Claim state now rather than on its next 90s poll.
    qc.invalidateQueries({ queryKey: ['dailyQuests'] });
    if (row.claimed_at) return;
    toast.success(
      tf('dashboard.questCompleteToast', 'Quest complete: {label}', { label: questLabel(row.quest_id, tt) }),
      {
        id: `quest-${row.id}`,
        icon: '🎯',
        description: tf('dashboard.questCompleteClaimHint', 'Tap to claim your reward'),
        duration: 8000,
        action: {
          label: tt('dashboard.claim'),
          onClick: () => {
            const c = ctx.current;
            claimQuestWithFeedback({
              user: c.user, row, t: c.t, tFallback: c.tFallback, queryClient: c.queryClient,
            });
          },
        },
      },
    );
  }), []);

  return null;
}
