// src/hooks/useLocalDateKey.js
//
// Today's LOCAL date as 'yyyy-MM-dd', re-checked every minute so a screen
// left open across midnight rolls over to the new day.
//
// For query keys. The daily-log reads (sleep, mood, steps) compute "today"
// inside their queryFn, but a key with no date in it keeps serving
// yesterday's cached row after midnight, because nothing about the key
// changed. Putting this in the key makes the new day a new cache entry.
//
// The value is a KEY, not display text, so it stays in this fixed format
// whatever the reader's language.

import { useEffect, useState } from 'react';
import { format } from 'date-fns';

export const localDateKey = (d = new Date()) => format(d, 'yyyy-MM-dd');

export function useLocalDateKey() {
  const [key, setKey] = useState(() => localDateKey());
  useEffect(() => {
    const tick = () => {
      const next = localDateKey();
      setKey((prev) => (prev === next ? prev : next));
    };
    const id = setInterval(tick, 60_000);
    // A backgrounded PWA throttles timers; check again the moment it is back.
    const onVis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return key;
}
