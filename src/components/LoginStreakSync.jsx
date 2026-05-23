// src/components/LoginStreakSync.jsx
//
// Global, route-independent sync for the login streak. Fires exactly
// once per signed-in session and:
//
//   1. Updates `user_profiles.last_login_date` so the welcome-back cron
//      (migration 037) sees the user as ACTIVE on every session, not
//      just the ones where they happened to visit /dashboard.
//   2. Shows the streak toast (and elite-capsule sub-toast) on
//      milestone days, regardless of which page the user landed on.
//   3. Inserts the streak-milestone notification (migration 034's
//      trigger then fans out push).
//
// WHY this lives at the App level, not inside Dashboard:
//   The previous implementation lived in LoginStreakBanner, which
//   only mounts on /dashboard. Users who opened the app and went
//   straight to /workout or /hub (a typical pattern) never updated
//   their last_login_date — leading to: (a) broken login streaks,
//   (b) welcome-back nudges firing for actively-engaged users who
//   simply avoided Dashboard. Audit caught this as a real bug.
//
// Renders null. Mount it once globally inside the authenticated tree.

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import * as loginStreak from '@/lib/data/loginStreak';
import * as notifications from '@/lib/data/notifications';

// Days on which a coin reward triggers the in-app notification (and
// the corresponding push). Kept in sync with the toast logic below.
const MILESTONE_DAYS = new Set([1, 3, 5, 7, 14, 21, 30, 60, 100]);

export default function LoginStreakSync() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  // Track which user.id we've already recorded for. A simple boolean
  // didn't reset on sign-out → sign-in-as-different-user, so the new
  // session's streak never recorded. Storing the id makes the gate
  // user-aware while still preventing per-mount double-fires.
  const recordedForUserIdRef = useRef(null);

  useEffect(() => {
    if (!user?.id) return;
    if (recordedForUserIdRef.current === user.id) return;
    recordedForUserIdRef.current = user.id;

    loginStreak.recordLogin(user).then((result) => {
      if (!result?.isNewDay || result.coinsAwarded <= 0) return;

      // ── Streak toast ────────────────────────────────────────────────
      const tplKey = result.freezeUsed
        ? 'dashboard.streakSavedToast'
        : 'dashboard.streakDayToast';
      const msg = t(tplKey)
        .replace('{day}',   result.streak)
        .replace('{coins}', result.coinsAwarded);
      toast.success(msg, { icon: '🔥', duration: 4500 });

      // Full confetti burst on milestone streak days (7, 14, 30, 60, 100…)
      if (MILESTONE_DAYS.has(result.streak)) {
        import('canvas-confetti').then(({ default: confetti }) => {
          const fire = (opts) => confetti({
            particleCount: 120,
            spread: 80,
            gravity: 0.9,
            colors: ['#f97316', '#fbbf24', '#ef4444', '#a855f7', '#3b82f6'],
            ...opts,
          });
          fire({ origin: { x: 0.2, y: 0.55 } });
          setTimeout(() => fire({ origin: { x: 0.8, y: 0.55 } }), 180);
          setTimeout(() => fire({ origin: { x: 0.5, y: 0.4 }, particleCount: 60, spread: 50 }), 350);
        }).catch(() => {});
      }

      // Elite capsule sub-toast on milestone days.
      if (result.eliteCapsuleAwarded) {
        setTimeout(() => {
          toast.success(
            t('dashboard.eliteCapsuleToast').replace('{day}', result.streak),
            { icon: '💎', duration: 5000 }
          );
        }, 600);
      }

      // ── Cache invalidation ──────────────────────────────────────────
      // Banner + sidebar + capsule count all read from these queries;
      // invalidate so their UI catches up with the freshly-awarded coins.
      queryClient.invalidateQueries({ queryKey: ['loginStreakProfile'] });
      queryClient.invalidateQueries({ queryKey: ['userProfile', user.email] });
      queryClient.invalidateQueries({ queryKey: ['userCapsulesCount', user.email] });

      // ── In-app notification (push fans out via migration 034) ───────
      if (MILESTONE_DAYS.has(result.streak) || result.eliteCapsuleAwarded) {
        notifications.notifyStreakMilestone({
          user,
          kind: 'login',
          day: result.streak,
          coinsAwarded: result.coinsAwarded,
          eliteCapsuleAwarded: result.eliteCapsuleAwarded,
          t,
        })
          .then(() => queryClient.invalidateQueries({
            queryKey: ['notificationsUnread', user.id],
          }))
          .catch(() => {});
      }
    }).catch((err) => {
      console.warn('[LoginStreakSync] recordLogin failed:', err);
    });
    // Dep on user?.id (stable string) instead of the whole user object.
    // user is a new reference on every AuthContext value change even
    // when the identity hasn't moved — depending on the whole object
    // re-ran this effect on unrelated context updates.
  }, [user?.id, user?.email, queryClient, t]);

  return null;
}
