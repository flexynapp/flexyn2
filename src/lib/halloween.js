// src/lib/halloween.js
//
// The Halloween skin: a seasonal, opt-in re-tint of the neutral ramp.
//
// It is NOT one of the level-up / loot themes in ThemeContext's THEMES.
// Those are switched off (THEMES_ENABLED, Aug 2026) and they work by
// swapping --primary, which the four-hue rule in index.css reserves. This
// keeps the brand orange exactly where it is (it is already pumpkin) and
// only warms the surfaces around it, so every state colour still means
// what it meant. The CSS lives in index.css under [data-season="halloween"].
//
// Seasonal on purpose: outside the window the skin is off for everyone and
// the Settings row disappears, so nobody is left in October colours in
// March because they forgot a toggle.
//
// One localStorage key per season does two jobs. Absent means the user has
// not answered yet, which is what makes the one-time prompt show; 'on' or
// 'off' is both their choice and the record that the prompt is done. The
// year is in the key so next October asks again rather than inheriting a
// "no" from last year. Per device, like haptics and sound: it is a look,
// and nothing is lost if a second phone asks once more.

export const HALLOWEEN_EVENT = 'flexyn:halloween-changed';

// Local calendar dates, inclusive. Late September so the skin is there for
// the whole of October rather than arriving on the 1st, and through the day
// after Halloween so it doesn't vanish at midnight on the night itself.
const START = { month: 8, day: 25 }; // Sept 25 (0-based month)
const END = { month: 10, day: 1 };   // Nov 1

export function isHalloweenSeason(now = new Date()) {
  const m = now.getMonth();
  const d = now.getDate();
  const afterStart = m > START.month || (m === START.month && d >= START.day);
  const beforeEnd = m < END.month || (m === END.month && d <= END.day);
  return afterStart && beforeEnd;
}

export function halloweenStorageKey(now = new Date()) {
  return `flexyn.halloween.${now.getFullYear()}`;
}

/** 'on' | 'off' | null (not answered this season). */
export function readHalloweenChoice(now = new Date()) {
  try {
    const v = localStorage.getItem(halloweenStorageKey(now));
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

export function writeHalloweenChoice(on, now = new Date()) {
  try { localStorage.setItem(halloweenStorageKey(now), on ? 'on' : 'off'); } catch { /* private mode */ }
}

/** True only in season AND when the user switched it on. */
export function isHalloweenActive(now = new Date()) {
  return isHalloweenSeason(now) && readHalloweenChoice(now) === 'on';
}
