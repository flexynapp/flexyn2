// src/components/__tests__/overlayScrollLock.test.js
//
// Every overlay that paints over a scrolling page has to hold that page
// still, and this fails the suite when a new one doesn't.
//
// The rule exists because the defect is invisible in review and almost
// invisible in use: the overlay looks right, and only a finger that reaches
// the end of its content — or lands on a part of it that doesn't scroll —
// takes the page behind it for a ride. Sixty-one surfaces in this app had
// it at once, and the first sweep still missed four (Gauntlet's two modals,
// Nutrition's scanner, TwoFactorSection's enrollment, CorporatePortal's
// challenge form) because it was done by reading a report rather than by
// enumerating the tree.
//
// Two ways to satisfy it:
//   • call `useBodyScrollLock(<open>)` — see @/hooks/useBodyScrollLock
//   • or build on a primitive that holds the page itself (Radix Dialog /
//     AlertDialog / Select / DropdownMenu, vaul Drawer, our BottomSheet)
//
// If a surface is genuinely full-screen with nothing behind it — a splash,
// a signed-out page, the onboarding shell — add it to ALLOWED with the
// reason. That list is the point of the test: every entry is a decision
// somebody made on purpose.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

// A bare overlay: positioned over the whole viewport by this file's own
// markup rather than by a library.
const BARE_OVERLAY = [
  /fixed\s+inset-0/,
  /fixed\s+inset-x-0\s+bottom-0/,
  /position:\s*['"]fixed['"]/,
];

// Primitives that pin the page themselves — Radix goes through
// react-remove-scroll, vaul does its own.
const DELEGATES = [
  /from ['"]@\/components\/ui\/dialog['"]/,
  /from ['"]@\/components\/ui\/alert-dialog['"]/,
  /from ['"]@\/components\/ui\/drawer['"]/,
  /from ['"]@\/components\/ui\/BottomSheet['"]/,
  /from ['"]@\/components\/ui\/select['"]/,
  /from ['"]@\/components\/ui\/dropdown-menu['"]/,
  /from ['"]vaul['"]/,
  /@radix-ui\/react-(dialog|alert-dialog|select|dropdown-menu|popover)/,
];

// Surfaces with no page behind them, and the one deliberate exception.
const ALLOWED = new Map([
  ['src/App.jsx',                            'route shell + the signed-out gate; there is no page behind it'],
  ['src/lib/LanguageContext.jsx',            'first-run language gate, full screen before the app renders'],
  ['src/components/AccountDeletedScreen.jsx','terminal full-screen state'],
  ['src/components/LaunchSplash.jsx',        'splash'],
  ['src/components/SplashScreen.jsx',        'splash'],
  ['src/pages/Splash.jsx',                   'splash'],
  ['src/pages/SignInToContinue.jsx',         'signed-out full-screen page'],
  ['src/pages/PublicProfile.jsx',            'signed-out full-screen page'],
  ['src/pages/PublicGymLanding.jsx',         'signed-out full-screen page'],
  ['src/pages/Onboarding.jsx',               'own fixed 100svh shell, already overflow-hidden'],
  ['src/pages/GymMap.jsx',                   'route AND overlay, fixed inset-0 either way; the lock would also arbitrate gestures against maplibre — see the note in the file'],
  ['src/components/ThemeAnimationLayer.jsx', 'pointer-events-none decoration'],
  ['src/components/leagues/LeagueFluid.jsx', 'pointer-events-none backdrop inside RankUpSequence, which holds the lock'],
  ['src/components/capsules/openFx.jsx',    'pointer-events-none stage layer inside CapsuleOpener, which holds the lock'],
  ['src/components/skins/halloween/HalloweenBackdrop.jsx', 'pointer-events-none scene behind the page, never a surface'],
  ['src/components/OneShotTooltip.jsx',      'a tooltip, not a menu — holding the page for one would be wrong; it tracks its anchor through the scroll instead'],
  ['src/components/ui/dialog.jsx',           'the Radix primitive itself'],
  ['src/components/ui/alert-dialog.jsx',     'the Radix primitive itself'],
  ['src/components/ui/drawer.jsx',           'the vaul primitive itself'],
]);

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!/^(__tests__|locales|test)$/.test(entry.name)) sourceFiles(p, out);
    } else if (/\.jsx?$/.test(entry.name)) {
      out.push(p);
    }
  }
  return out;
}

describe('every overlay holds the page behind it', () => {
  it('has no bare full-viewport overlay without a scroll lock', () => {
    const offenders = [];

    for (const file of sourceFiles(SRC)) {
      const src = fs.readFileSync(file, 'utf8');
      if (!BARE_OVERLAY.some((re) => re.test(src))) continue;

      const rel = path.relative(path.resolve(SRC, '..'), file);
      if (ALLOWED.has(rel)) continue;
      if (/useBodyScrollLock/.test(src)) continue;
      if (DELEGATES.some((re) => re.test(src))) continue;

      offenders.push(rel);
    }

    expect(
      offenders,
      'These render a full-viewport overlay and nothing holds the page behind '
      + 'it. Call useBodyScrollLock(<open>), build on a primitive that locks '
      + '(Radix Dialog, vaul Drawer, ui/BottomSheet), or add the file to '
      + 'ALLOWED in this test with the reason it needs no lock.',
    ).toEqual([]);
  });

  it('keeps the allowlist honest — every entry still exists and still overlays', () => {
    const stale = [];
    for (const [rel, reason] of ALLOWED) {
      const abs = path.resolve(SRC, '..', rel);
      if (!fs.existsSync(abs)) { stale.push(`${rel} (gone) — was: ${reason}`); continue; }
      const src = fs.readFileSync(abs, 'utf8');
      if (!BARE_OVERLAY.some((re) => re.test(src))) {
        stale.push(`${rel} (no longer an overlay) — was: ${reason}`);
      }
    }
    expect(stale, 'Allowlist entries that no longer apply — delete them.').toEqual([]);
  });
});
