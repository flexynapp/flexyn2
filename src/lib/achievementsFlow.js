// src/lib/achievementsFlow.js
//
// Tiny event helper so surfaces outside ProfileMenu can ask it to
// open the AchievementsVault without importing the vault component
// (which would defeat ProfileMenu's lazy() chunking).
//
// Modeled on `requestOpenBag` in src/lib/inventoryFlow.js — same
// pattern, same convention.

export const OPEN_ACHIEVEMENTS_EVENT = 'flexyn-open-achievements';

/** Dispatch the open-achievements event for ProfileMenu to handle. */
export function requestOpenAchievements() {
  window.dispatchEvent(new CustomEvent(OPEN_ACHIEVEMENTS_EVENT));
}
