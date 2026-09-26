// src/components/workout/PostWorkoutPushAsk.jsx
//
// Asks to turn on notifications right after a workout is saved, the
// moment someone cares most about their streak.
//
// Production had 0 push subscriptions. Every streak warning, crew war
// alert and weekly review notification went to nobody, because the only
// asks were a Settings toggle and a banner near the bottom of Today. The
// banner stays; this is the ask at the moment it is most likely to be
// accepted.
//
// Shown once per device per account, only when a yes is still possible:
// push supported, not already subscribed, and the browser has not been
// answered yet. A browser "Block" cannot be undone from inside the app,
// so an ask that could only fail is never shown. On iOS outside an
// installed PWA, web push is not available at all, and IosInstallBanner
// is the path there.
//
// Workout.jsx arms this when the post-save share card closes, so the two
// sheets never stack. The component stays mounted for the whole page so
// the subscription check has resolved long before it is armed; reading
// isSubscribed at arm time would otherwise see its initial `false` and
// ask someone who is already subscribed.

import React, { useEffect, useState } from 'react';
import { Bell } from 'lucide-react';
import BottomSheet from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { useLanguage } from '@/lib/LanguageContext';
import { usePushSubscription } from '@/lib/usePushSubscription';
import { toast } from '@/lib/toast';
import { track, EVENTS } from '@/lib/analytics';

const ASKED_KEY = (userId) => `flexyn.pushAskAfterWorkout.${userId || 'anon'}`;

function readAsked(userId) {
  try { return localStorage.getItem(ASKED_KEY(userId)) === '1'; } catch { return false; }
}
function writeAsked(userId) {
  try { localStorage.setItem(ASKED_KEY(userId), '1'); } catch { /* best-effort */ }
}

export function shouldAskAfterWorkout({ isSupported, isSubscribed, permission, asked }) {
  return !!isSupported && !isSubscribed && permission === 'default' && !asked;
}

export default function PostWorkoutPushAsk({ armed, onDone }) {
  const { user } = useAuth();
  const { tFallback } = useLanguage();
  const push = usePushSubscription();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const eligible = shouldAskAfterWorkout({
      isSupported: push.isSupported,
      isSubscribed: push.isSubscribed,
      permission: push.permission,
      asked: readAsked(user?.id),
    });
    if (eligible) {
      // Recorded on SHOW, not on answer: closing the sheet by swipe or
      // Back is an answer too, and it must not come back next workout.
      writeAsked(user?.id);
      setOpen(true);
    } else {
      onDone?.();
    }
  }, [armed]); // eslint-disable-line react-hooks/exhaustive-deps

  const close = () => {
    setOpen(false);
    onDone?.();
  };

  const enable = async () => {
    const res = await push.subscribe();
    if (res.ok) {
      track(EVENTS.PUSH_ENABLED, { where: 'after_workout' });
      toast.success(tFallback('pushOptIn.success', 'Notifications enabled. See you out there.'));
    } else if (res.reason === 'denied') {
      toast.error(tFallback('pushOptIn.denied',
        'Permission denied. Enable notifications in your browser settings to re-try.'));
    } else if (res.reason === 'server_error') {
      toast.error(tFallback('pushOptIn.serverError', 'Could not save your subscription. Try again later.'));
    }
    close();
  };

  return (
    <BottomSheet open={open} onClose={close} title={tFallback('pushAsk.title', 'Keep your streak alive')}>
      <div className="flex flex-col gap-6 px-4 pb-4">
        <div className="flex items-start gap-2">
          <Bell className="w-5 h-5 shrink-0 text-primary mt-0.5" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">
            {tFallback('pushAsk.body',
              'Get a heads up before your streak breaks, when your crew needs you, and when your weekly review is ready.')}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button type="button" className="min-h-12" onClick={enable} disabled={push.isLoading}>
            {push.isLoading
              ? tFallback('pushOptIn.enabling', 'Enabling…')
              : tFallback('pushAsk.enable', 'Turn on notifications')}
          </Button>
          <Button type="button" variant="ghost" className="min-h-12" onClick={close}>
            {tFallback('pushOptIn.notNow', 'Not now')}
          </Button>
        </div>
      </div>
    </BottomSheet>
  );
}
