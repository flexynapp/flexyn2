// Themes are switched off (src/lib/featureFlags.js). This file pins the
// four promises that switch-off makes, because each one is enforced in a
// different module and a partial re-enable is the failure mode that would
// hurt: a user who can still see themes advertised, or a stranger's
// profile still painting itself in a palette nobody can choose.
//
// Every assertion is derived from THEMES_ENABLED rather than hardcoded to
// `false`, so flipping the flag back to true re-arms the original
// behaviour here instead of turning this file red.

import { describe, it, expect, vi } from 'vitest';

// themeScope → ThemeContext → @/api/db, which registers a
// supabase.auth.onAuthStateChange listener at module scope. See the
// "Profile cache" section of CLAUDE.md — importing it for real breaks any
// test that stubs the supabase client, so it's stubbed to nothing here.
vi.mock('@/api/db', () => ({ db: { auth: { me: vi.fn(), updateMe: vi.fn() } } }));

import { THEMES_ENABLED } from '../featureFlags';
import { THEMES, DEFAULT_THEME_ID } from '../ThemeContext';
import { LOOT_THEMES } from '../lootThemes';
import { getThemeStyle, getThemePreview, isAnimatedTheme } from '../themeScope';
import { COLLECTION_TABS, catalogFor } from '../collection';
import { buildCandidateMenu } from '../lootRoll';

const DEFAULT_THEME = THEMES.find(t => t.id === DEFAULT_THEME_ID);

describe('the default theme is the only one in play', () => {
  it('DEFAULT_THEME_ID names a real theme, and it is the one ThemeContext falls back to', () => {
    expect(DEFAULT_THEME).toBeTruthy();
    expect(THEMES[0].id).toBe(DEFAULT_THEME_ID);
  });

  it('resolves a loot theme id to the default palette', () => {
    const loot = LOOT_THEMES[0];
    expect(loot).toBeTruthy();
    const style = getThemeStyle({ themeId: DEFAULT_THEME_ID, lootThemeId: loot.id });
    const expected = THEMES_ENABLED ? loot.vars : DEFAULT_THEME.vars;
    expect(style).toEqual(expected);
  });

  // The one that bites cross-user: `preferred_theme` is still on every
  // row, so a level-40 user's profile would keep rendering in Midnight
  // for everyone viewing it unless themeScope short-circuits.
  it('resolves another user\'s level-up theme to the default palette', () => {
    const other = THEMES.find(t => t.id !== DEFAULT_THEME_ID && !t.adminOnly);
    expect(other).toBeTruthy();
    const style = getThemeStyle({ themeId: other.id, lootThemeId: null });
    expect(style).toEqual(THEMES_ENABLED ? other.vars : DEFAULT_THEME.vars);
  });

  it('reports no animated tier, so no scene layer paints over the default palette', () => {
    const animated = LOOT_THEMES.find(t => t.animated);
    expect(animated).toBeTruthy();
    expect(isAnimatedTheme({ lootThemeId: animated.id })).toBe(THEMES_ENABLED);
  });

  it('hands back the default preview swatches for a loot id', () => {
    const loot = LOOT_THEMES[0];
    const preview = getThemePreview({ lootThemeId: loot.id });
    expect(preview).toEqual(THEMES_ENABLED ? loot.preview : DEFAULT_THEME.preview);
  });
});

describe('themes are not advertised as a reward', () => {
  it('has no Themes tab in the collection grid', () => {
    const ids = COLLECTION_TABS.map(t => t.id);
    expect(ids.includes('themes')).toBe(THEMES_ENABLED);
  });

  // Deliberately still resolvable: an already-owned theme has to render
  // in the Bag, and `_pick_loot_item` can still hand one back for a row
  // granted before the switch-off.
  it('still knows the theme catalog, so nothing already owned is orphaned', () => {
    expect(catalogFor('themes').length).toBe(LOOT_THEMES.length);
  });

  it('sends the server no theme candidates', () => {
    const keys = Object.keys(buildCandidateMenu());
    expect(keys.some(k => k.startsWith('theme:'))).toBe(THEMES_ENABLED);
    // The categories that still drop must be untouched by this — the
    // migration moved theme's weight to stickers and left title/frame
    // exactly where they were.
    for (const cat of ['sticker', 'title', 'frame']) {
      expect(keys.some(k => k.startsWith(cat + ':')), `${cat} missing`).toBe(true);
    }
  });
});
