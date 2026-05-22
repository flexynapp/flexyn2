// src/hooks/useNetworkStatus.js
//
// Tracks browser online/offline state. Returns `{ online, justReconnected }`
// where `justReconnected` is true for ~1.5s after a transition from
// offline → online (so the UI can show a brief "Back online" affordance
// before fading back to nothing).
//
// Listens to native online/offline events. We deliberately do NOT do
// periodic connectivity probing — those generate network traffic and
// false positives (captive portals, etc). The native events are good
// enough for the "is the user genuinely offline" question on modern
// browsers; if we hit reliability issues we can layer in active probing
// later.

import { useEffect, useState } from 'react';

const RECONNECT_FLASH_MS = 1500;

export function useNetworkStatus() {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [justReconnected, setJustReconnected] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let flashTimer = null;

    const handleOnline = () => {
      setOnline((prev) => {
        if (!prev) {
          // Genuine transition from offline → online. Flash the "back
          // online" chip for a moment before fading out.
          setJustReconnected(true);
          if (flashTimer) clearTimeout(flashTimer);
          flashTimer = setTimeout(() => setJustReconnected(false), RECONNECT_FLASH_MS);
        }
        return true;
      });
    };
    const handleOffline = () => {
      setOnline(false);
      setJustReconnected(false);
      if (flashTimer) clearTimeout(flashTimer);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      if (flashTimer) clearTimeout(flashTimer);
    };
  }, []);

  return { online, justReconnected };
}
