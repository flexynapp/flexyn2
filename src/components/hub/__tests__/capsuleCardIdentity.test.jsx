// Regression test for d2472f4 — the capsule row's UUID must survive the
// merge with its catalog metadata.
//
// The bug: CapsuleCard handed the opener `{ ...capsuleRow, ...meta }`. `meta`
// is a loot_catalog entry and carries its own `id` ('cap_premium'), so the
// second spread overwrote the row's UUID. CapsuleOpener passes that value
// straight to `open_capsule_atomic` as `p_capsule_id`, and Postgres answered
//
//     ERROR: invalid input syntax for type uuid: "cap_premium"
//
// Every capsule opened from a single card failed, for every user and every
// type. The batch button passes raw rows, which is why "open all N" worked and
// a lone capsule did not — and why it read as "premium capsules are broken".
//
// Two tests here, and the second is the one that keeps the first honest.
// Asserting the merge order alone would go quietly green if someone ever
// removed `id` from the capsule entries in lootCatalog: with no `id` on `meta`
// there is nothing to clobber, both spread orders pass, and the test would
// still be sitting there looking like cover. So `CAPSULE_META` is asserted to
// still carry a colliding `id` — if that stops being true, this file fails and
// says why rather than going silently inert.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// These components now read tFallback, and useLanguage() throws outside a
// provider by design. Resolving the real English catalog rather than returning
// key paths, so any assertion here still reads like the screen.
vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});


// Presentation only — none of it participates in what the button emits, and
// RarityFrame renders as a plain wrapper so the button stays reachable.
vi.mock('@/components/loot/RarityVisuals', () => ({
  RarityFrame: ({ children }) => <div>{children}</div>,
  RarityBadge: ({ rarity }) => <span>{rarity}</span>,
  rarityTint: () => '',
  COIN: '🪙',
}));
vi.mock('@/components/loot/CapsuleIcon', () => ({ default: () => <div /> }));
vi.mock('@/components/hub/CoinShopModal', () => ({ default: () => null }));
vi.mock('@/components/hub/StickerDisplay', () => ({ default: () => null }));

// Module-level imports of UserBag.jsx that would otherwise reach for a live
// client, a provider, or a listener. The card itself touches none of them.
vi.mock('@/lib/data/inventory', () => ({}));
vi.mock('@/lib/data/capsules', () => ({}));
vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));
vi.mock('@/api/profileCache', () => ({ patchProfile: vi.fn() }));
vi.mock('@/api/safeSelect', () => ({ safeSelect: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/ThemeContext', () => ({ useTheme: () => ({ theme: 'light' }) }));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));

const { CapsuleCard } = await import('../UserBag');
const { ITEMS } = await import('@/lib/lootCatalog');

// A real user_capsules row is keyed by UUID. The exact value doesn't matter —
// that it is NOT the catalog id does.
const ROW_UUID = '3f8c1d2e-9a47-4b6d-8e15-2c0b7a9f4d3e';

const onOpenCapsule = vi.fn();

beforeEach(() => onOpenCapsule.mockReset());

function openCapsuleOfType(capsule_type) {
  render(
    <CapsuleCard
      capsuleRow={{ id: ROW_UUID, capsule_type, opened_at: null }}
      onOpenCapsule={onOpenCapsule}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: /open/i }));
  return onOpenCapsule.mock.calls[0][0];
}

describe('CapsuleCard — the row id reaches the opener', () => {
  // All three types, because the bug was never type-specific even though the
  // report was: whichever type happened to be alone in its group broke.
  it.each(['standard', 'premium', 'elite'])(
    'passes the row UUID, not the catalog id, for a %s capsule',
    (capsule_type) => {
      const emitted = openCapsuleOfType(capsule_type);

      // The assertion that fails on the pre-d2472f4 spread order. Under it,
      // `emitted.id` was 'cap_premium' / 'cap_standard' / 'cap_elite'.
      expect(emitted.id).toBe(ROW_UUID);

      // CapsuleOpener reads exactly these two fields off the merged object;
      // the id is what `open_capsule_atomic` rejects, the type is what picks
      // the reel. Both have to come from the row.
      expect(emitted.capsule_type).toBe(capsule_type);

      // The merge is still doing its job — catalog fields the opener shows
      // are present, so this is a fix to the ORDER and not a removal.
      expect(emitted.name).toBeTruthy();
      expect(emitted.rarity).toBeTruthy();
    }
  );

  it('an unknown capsule_type still emits the row id', () => {
    // CAPSULE_META falls back to `standard` for a type it doesn't know, which
    // is a fourth path through the same merge. A new capsule tier shipped
    // server-side before the client catalog knows it must not resurrect the
    // clobber on the way through that fallback.
    const emitted = openCapsuleOfType('mythic');
    expect(emitted.id).toBe(ROW_UUID);
    expect(emitted.capsule_type).toBe('mythic');
  });
});

describe('the collision this test exists to catch is still possible', () => {
  it('the capsule catalog entries still carry an id that would clobber', () => {
    // If this ever fails, the tests above stopped being able to fail and
    // should be re-read rather than deleted: no `id` on the catalog entry
    // means no clobber, so both spread orders would pass.
    const capsuleItems = ITEMS.filter((i) => i.type === 'capsule');
    expect(capsuleItems.length).toBeGreaterThan(0);

    for (const item of capsuleItems) {
      expect(item.id).toBeTruthy();
      expect(item.id).not.toBe(ROW_UUID);
      // A string id that is not UUID-shaped is precisely what Postgres
      // rejected. Pinning the shape documents why the bug was a 500 and not
      // a silently wrong capsule being opened.
      expect(item.id).not.toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      );
    }
  });
});
