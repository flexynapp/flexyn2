// src/lib/skins.js
//
// Skins: whole-app looks layered on the design tokens. The Halloween look is
// the first; this module is the structure every later one plugs into.
//
// A skin is two halves, deliberately split:
//
//   • DATA, here. Its id, when it is available, and the copy keys for its
//     switch and its one-time offer. No React, so ThemeContext, tests and
//     any future server check can read it without pulling in components.
//   • PARTS, in src/components/skins/<id>/. Its CSS (token overrides under
//     html[data-skin="<id>"]) and whichever ornaments it wants, from a fixed
//     set of slots the app renders: Overlay, Backdrop, NavEdge, LogoMark,
//     Icon, EmptyAccent. See src/components/skins/parts.js.
//
// How to add one: docs/skins.md.
//
// What a skin may and may not change, so a month of novelty can't break the
// app's meaning:
//   • It may move the NEUTRAL ramp (background, card, border, muted). It may
//     not redefine --primary, --success, --info or --destructive: the
//     four-hue rule in index.css gives each of those a meaning, and a skin
//     that repaints "success" repaints every "you did it" in the app.
//   • Ornaments never take a tap (pointer-events none), never sit above the
//     header, dialogs or toasts, animate transform/opacity only, and drop
//     their motion under prefers-reduced-motion.
//
// Choice storage. One localStorage key per skin per window does two jobs:
// absent means "not answered yet", which is what makes the offer show;
// 'on' / 'off' is both the choice and the record that the offer is done.
// The key carries the year the window OPENED, so next season asks again,
// and a window that crosses New Year (a winter skin, Dec 1 to Jan 2) keeps
// one key rather than asking twice. Per device, like haptics and sound: a
// look is cheap to re-ask on a second phone and needs no database column.
//
// The old level-up and capsule themes (ThemeContext THEMES, lootThemes.js)
// are NOT on this yet. They swap --primary, which the rule above forbids,
// and are switched off (THEMES_ENABLED). Rebuilding them as skins with
// `window: null` and an unlock rule is the intended next step.

export const SKIN_EVENT = 'flexyn:skin-changed';

/**
 * Registered skins. Windows are local calendar dates, inclusive, months
 * 1-based. `window: null` would mean "always available" (reserved for the
 * rebuilt level-up themes); every entry today is seasonal.
 */
export const SKINS = [
  {
    id: 'halloween',
    // Late September so it is there for all of October, through the day
    // after Halloween so it doesn't vanish on the night itself.
    window: { start: { month: 9, day: 25 }, end: { month: 11, day: 1 } },
    copy: {
      name: ['skin.halloween.name', 'Halloween look'],
      hint: ['skin.halloween.hint', 'Autumn colours, cobwebs, a witch and a pumpkin patch until November 1.'],
      offerTitle: ['skin.halloween.offerTitle', 'Halloween look is here'],
      offerBody: ['skin.halloween.offerBody', 'Autumn colours, cobwebs, a witch and a pumpkin patch until November 1. Turn it off anytime from the You tab.'],
    },
  },
];

const dayOfYearKey = (month, day) => month * 100 + day;

function windowState(skin, now) {
  if (!skin.window) return { open: true, openedYear: 'always' };
  const { start, end } = skin.window;
  const today = dayOfYearKey(now.getMonth() + 1, now.getDate());
  const s = dayOfYearKey(start.month, start.day);
  const e = dayOfYearKey(end.month, end.day);
  const year = now.getFullYear();
  if (s <= e) {
    return { open: today >= s && today <= e, openedYear: year };
  }
  // Wraps New Year: open from start to Dec 31, and from Jan 1 to end.
  if (today >= s) return { open: true, openedYear: year };
  if (today <= e) return { open: true, openedYear: year - 1 };
  return { open: false, openedYear: year };
}

export function isSkinInWindow(skin, now = new Date()) {
  return windowState(skin, now).open;
}

/** The skin whose window is open right now, or null. Windows must not overlap. */
export function availableSkin(now = new Date(), skins = SKINS) {
  return skins.find((s) => s.window && isSkinInWindow(s, now)) || null;
}

export function skinStorageKey(skin, now = new Date()) {
  return `flexyn.skin.${skin.id}.${windowState(skin, now).openedYear}`;
}

/** 'on' | 'off' | null (not answered in this window). */
export function readSkinChoice(skin, now = new Date()) {
  if (!skin) return null;
  try {
    const v = localStorage.getItem(skinStorageKey(skin, now));
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

export function writeSkinChoice(skin, on, now = new Date()) {
  if (!skin) return;
  try { localStorage.setItem(skinStorageKey(skin, now), on ? 'on' : 'off'); } catch { /* private mode */ }
}

/** True only when the skin's window is open AND the user switched it on. */
export function isSkinOn(skin, now = new Date()) {
  return Boolean(skin) && isSkinInWindow(skin, now) && readSkinChoice(skin, now) === 'on';
}
