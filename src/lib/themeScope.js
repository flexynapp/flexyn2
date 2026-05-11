// src/lib/themeScope.js
//
// Tools for rendering a subtree in a different user's theme palette
// without affecting the rest of the app.
//
// Used when viewing another user's Hub profile — their primary/accent/ring
// colors apply to the profile card and feed area, while the viewer's
// dark/light mode and overall layout colors stay intact.
//
// Resolution order: loot theme first (capsule drops, animated tiers),
// then the level-up base theme. This mirrors ThemeContext's runtime apply
// order so a user's profile shows the same accent colors others see globally.

import { THEMES } from './ThemeContext';
import { LOOT_THEMES } from './lootThemes';

/**
 * Resolve a theme id (loot OR level-up) to its theme record.
 * Loot themes win when both ids are valid — that matches the global
 * apply order in ThemeContext (lootTheme overrides base theme).
 */
function resolveTheme({ lootThemeId, themeId }) {
  if (lootThemeId) {
    const loot = LOOT_THEMES.find(t => t.id === lootThemeId);
    if (loot) return loot;
  }
  if (themeId) {
    const base = THEMES.find(t => t.id === themeId);
    if (base) return base;
  }
  return THEMES[0];
}

/**
 * Resolve a theme to its CSS variable map.
 *
 * Accepts either a string (legacy single-id) or an object
 * `{ themeId, lootThemeId }`. Returns an inline-style object suitable for
 * spread onto a React element. Falls back to the first base theme.
 */
export function getThemeStyle(input) {
  const ids = typeof input === 'string'
    ? { themeId: input, lootThemeId: null }
    : (input || {});
  const theme = resolveTheme(ids);
  const out = {};
  for (const [k, v] of Object.entries(theme.vars || {})) {
    out[k] = v;
  }
  return out;
}

/**
 * Resolve a theme to its small accent-color array — useful for portal-based
 * overlays that can't inherit CSS vars from the scoped wrapper.
 *
 * Accepts string or `{ themeId, lootThemeId }` like getThemeStyle.
 */
export function getThemePreview(input) {
  const ids = typeof input === 'string'
    ? { themeId: input, lootThemeId: null }
    : (input || {});
  const theme = resolveTheme(ids);
  return theme.preview || ['#888', '#444'];
}

/**
 * True when the theme is animated (uncommon+ loot tiers). Lets callers
 * conditionally render frame animations on showcase cards.
 */
export function isAnimatedTheme(input) {
  const ids = typeof input === 'string'
    ? { themeId: input, lootThemeId: null }
    : (input || {});
  const theme = resolveTheme(ids);
  return !!theme.animated;
}