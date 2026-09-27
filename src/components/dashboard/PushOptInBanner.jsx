// src/components/dashboard/PushOptInBanner.jsx
//
// Dashboard banner that proactively offers the Web Push opt-in. Solves
// the discovery problem: every notification feature we built (nemesis,
// gauntlet, comments, duels, streak warnings, crew wars, etc.) only
// delivers to users who manually toggled the switch in Settings. Most
// users never visit Settings, so push reach stays flat near zero.
//
// SHOW CONDITIONS (all must be true)
// ──────────────────────────────────
//   1. Browser/PWA actually supports Web Push (push.isSupported)
//   2. User is NOT already subscribed (push.isSubscribed === false)
//   3. Notification.permission !== 'denied' — once they've explicitly
//      said no, we never re-ask. The browser's permission UI is the
//      only path back from a hard deny anyway.
//   4. User has logged at least one workout (proves they're engaged
//      enough to care about notifications; we don't pester brand-new
//      users on their first dashboard load before they know what
//      Flexyn even is).
//   5. User hasn't dismissed the banner before (localStorage per-user).
//
// DISMISSAL LIFECYCLE
// ───────────────────
//   • "Enable" → push.subscribe(). On success, the banner stops showing
//     because isSubscribed flips. On 'denied' or other rejection, we
//     write the dismissed flag so we don't pester.
//   • "Not now" → write the dismissed flag, hide.
//   • Either way: per-user localStorage flag means the banner never
//     re-appears once dismissed, even across sessions on this device.
//     Cross-device, the banner still shows on a NEW device — which is
//     correct: each device needs its own subscription.

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bell, X } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { usePushSubscription } from '@/lib/usePushSubscription';
import { track, EVENTS } from '@/lib/analytics';

// Per-user, per-device dismissal flag. Each device needs its own
// subscription (push subscriptions are bound to the browser instance),
// so the dismissal also has to be per-device — localStorage is the
// right granularity.
const DISMISS_KEY = (userId) => `flexyn.pushOptInDismissed.${userId || 'anon'}`;

// Two kinds of dismissal, stored differently because they expire differently.
//   '1'            the native prompt was shown and closed. Expires as soon as
//                  permission reads 'default' again (Audit 08 #23).
//   'snooze:<ms>'  the user pressed "Not now". Holds for SNOOZE_MS whatever
//                  the permission says. It used to be a plain '1', and since
//                  "Not now" never touches permission (it stays 'default'),
//                  the expiry rule above undid it on the very next visit.
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000;

function readDismissal(userId) {
  try { return localStorage.getItem(DISMISS_KEY(userId)); }
  catch { return null; }
}
function isSnoozed(raw, now = Date.now()) {
  if (!raw || !raw.startsWith('snooze:')) return false;
  const at = Number(raw.slice(7));
  return Number.isFinite(at) && now - at < SNOOZE_MS;
}
function writeDismissed(userId, value = '1') {
  try { localStorage.setItem(DISMISS_KEY(userId), value); }
  catch { /* best-effort */ }
}

export default function PushOptInBanner({ hasWorkouts = false }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const push = usePushSubscription();
  const [dismissed, setDismissed] = useState(true); // start hidden; promote to false in effect

  // Initialize the dismissed state from localStorage once the user is
  // known. We start `true` (hidden) so a flash of the banner doesn't
  // appear before we've read the flag.
  //
  // ALSO: if the browser permission is currently 'default' (the user
  // hasn't been asked, or they backed out of the native prompt last
  // time), treat the prior dismissal as expired. Previously we
  // perma-dismissed on any "denied" outcome including the native
  // prompt being closed — users who later enabled notifications in
  // browser settings could never see the banner again from Dashboard.
  // (Audit 08 #23.)
  useEffect(() => {
    if (!user?.id) return;
    const raw = readDismissal(user.id);
    if (isSnoozed(raw)) {
      setDismissed(true);
      return;
    }
    if (push.permission === 'default') {
      setDismissed(false);
      return;
    }
    setDismissed(raw === '1');
  }, [user?.id, push.permission]);

  // Gate all the show conditions in one place. Each is intentionally
  // explicit (rather than collapsing) so a future reader can read the
  // policy off the conditional.
  const shouldShow =
    !!user?.id &&
    !dismissed &&
    push.isSupported &&
    !push.isSubscribed &&
    push.permission !== 'denied' &&
    hasWorkouts;

  const handleEnable = async () => {
    const res = await push.subscribe();
    if (res.ok) {
      track(EVENTS.PUSH_ENABLED, { where: 'today_banner' });
      toast.success(
        tFallback('pushOptIn.success', 'Notifications enabled. See you out there.'),
      );
      // No need to write dismissed — push.isSubscribed flips and the
      // banner stops rendering. We DO leave the dismissed flag unset so
      // that if the user later unsubscribes via Settings and stays
      // unsubscribed for a while, the next reset of localStorage could
      // re-offer. (Currently we'd still respect a separate "not now"
      // — only the enable path leaves the flag clean.)
      return;
    }
    if (res.reason === 'denied') {
      toast.error(
        tFallback(
          'pushOptIn.denied',
          'Permission denied. Enable notifications in your browser settings to re-try.',
        ),
      );
    } else if (res.reason === 'unsupported') {
      toast.error(
        tFallback('pushOptIn.unsupported', 'Push notifications aren\'t supported on this device.'),
      );
    } else if (res.reason === 'server_error') {
      toast.error(
        tFallback('pushOptIn.serverError', 'Could not save your subscription. Try again later.'),
      );
    }
    // 'default' (user dismissed the browser prompt without picking) —
    // no toast, we just dismiss the banner so we don't re-prompt. The
    // user can re-enable via Settings if they change their mind.
    writeDismissed(user.id);
    setDismissed(true);
  };

  const handleDismiss = () => {
    writeDismissed(user?.id, `snooze:${Date.now()}`);
    setDismissed(true);
  };

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4, transition: { duration: 0.18 } }}
          transition={{ duration: 0.2 }}
          className="relative overflow-hidden rounded-lg border border-primary/30 bg-primary/10 px-3 py-2.5 flex items-start gap-3"
          role="region"
          aria-label={tFallback('pushOptIn.aria', 'Enable notifications')}
        >
          <Bell className="w-4 h-4 shrink-0 text-primary mt-0.5" aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-heading font-bold leading-tight">
              {tFallback('pushOptIn.title', 'Stay in the loop')}
            </p>
            <p className="text-micro text-muted-foreground leading-snug mt-0.5">
              {tFallback(
                'pushOptIn.subtitle',
                'Get a ping when your Gym Rival logs a workout, your streak\'s at risk, or your crew needs you.',
              )}
            </p>
            <div className="flex items-center gap-2 mt-2">
              <button
                onClick={handleEnable}
                disabled={push.isLoading}
                className="px-3 py-1 rounded-sm text-micro font-bold bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 disabled:opacity-60 transition-colors"
              >
                {push.isLoading
                  ? tFallback('pushOptIn.enabling', 'Enabling…')
                  : tFallback('pushOptIn.enable', 'Enable')}
              </button>
              <button
                onClick={handleDismiss}
                className="px-2 py-1 rounded-sm text-micro font-medium text-muted-foreground hover:text-foreground active:text-foreground transition-colors"
              >
                {tFallback('pushOptIn.notNow', 'Not now')}
              </button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="shrink-0 -me-1 -mt-1 p-2.5 rounded-sm text-muted-foreground/70 hover:text-foreground active:text-foreground hover:bg-foreground/5 active:bg-foreground/10 transition-colors"
            aria-label={tFallback('pushOptIn.close', 'Dismiss')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
