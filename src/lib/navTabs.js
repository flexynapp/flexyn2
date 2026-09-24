// src/lib/navTabs.js
//
// The bottom-bar tabs. Only these remember their last view (tabMemory).
// Navigation redesign, phase 2: Today, Train, +, Social, You. Progress and
// Nutrition moved under You, Messages and the compete features under Social.
export const NAV_PATHS = ['/dashboard', '/workout', '/hub', '/you'];

// Pages that belong to a tab without being its root, so the tab stays lit
// while you are on them.
export const TAB_CHILDREN = {
  '/hub': ['/messages'],
  '/you': ['/progress', '/nutrition', '/profile', '/market', '/my-gym', '/settings'],
};
export function tabForPath(pathname) {
  if (NAV_PATHS.includes(pathname)) return pathname;
  return Object.keys(TAB_CHILDREN).find((tab) => TAB_CHILDREN[tab].includes(pathname)) || null;
}
