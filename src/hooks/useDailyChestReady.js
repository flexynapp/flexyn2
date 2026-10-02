// src/hooks/useDailyChestReady.js
//
// Whether today's daily capsule is waiting, for the dot on the sidebar's
// Market icon. It asks the same question, on the same UTC day, as the
// Claim row on the Market (DailyChestBlock) and the Today card, through
// isDailyChestReady.
//
// It used to be its own check in Layout.jsx: this device's localStorage
// only, on the LOCAL calendar day. Two ways that disagreed with the Market:
// a claim made late in the evening west of UTC (local date yesterday, UTC
// date today) lit the dot all the next morning while the Market said
// "claimed", so the dot pointed at nothing; and a claim on another device
// never cleared it. It also only re-read on a re-render, so claiming on
// the Market left the dot on until the next navigation.

import { useEffect, useState } from 'react';
import { getProfile } from '@/api/profileCache';
import { isDailyChestReady, DAILY_CHEST_CLAIMED_EVENT } from '@/lib/dailyChest';

export function useDailyChestReady(userId) {
  const check = () => isDailyChestReady(userId, getProfile()?.last_daily_chest_at);
  const [ready, setReady] = useState(check);

  useEffect(() => {
    if (!userId) { setReady(false); return undefined; }
    const recheck = () => setReady(isDailyChestReady(userId, getProfile()?.last_daily_chest_at));
    recheck();
    // A minute covers the UTC rollover in a tab left open; visibility
    // covers coming back to it.
    const id = setInterval(recheck, 60 * 1000);
    const onVis = () => { if (document.visibilityState === 'visible') recheck(); };
    window.addEventListener(DAILY_CHEST_CLAIMED_EVENT, recheck);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      window.removeEventListener(DAILY_CHEST_CLAIMED_EVENT, recheck);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [userId]);

  return ready;
}
