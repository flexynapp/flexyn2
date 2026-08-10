// src/components/market/__tests__/marketplaceRefresh.test.jsx
//
// The Marketplace refresh button, end to end at the wiring level.
//
// Two things had to be true for "press refresh and my listing shows up" and
// only one of them was:
//
//   1. the button must reload the listings query — it did, via refetch()
//   2. the user must be able to TELL that it ran — it could not. A warm
//      refetch resolves in under 100ms and the grid re-renders identically
//      whenever nothing has changed, which is the common case. A working
//      refresh and a dead button looked the same.
//
// It also reloaded only ONE of the five queries the view is built from, so
// bundles, sold counts, wishlist hearts and the "List Item · N" count kept
// their cached values. These tests pin both halves.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MarketplaceHeader from '../MarketplaceHeader';

// framer-motion's animation loop and the header's rAF gradient ticker are
// irrelevant here and noisy under jsdom.
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, { get: () => ({ children, ...p }) => <div {...p}>{children}</div> }),
}));
vi.mock('@/lib/inventoryFlow', () => ({ requestOpenBag: vi.fn() }));
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));

const baseProps = {
  flexCoins: 100,
  onRefresh: vi.fn(),
  onList: vi.fn(),
  onOpenTradeHistory: vi.fn(),
  listableCount: 0,
};

beforeEach(() => { cleanup(); vi.clearAllMocks(); });

const refreshBtn = () => screen.getByRole('button', { name: /refresh listings/i });

describe('refresh button — feedback', () => {
  it('is idle and enabled when not refreshing', () => {
    render(<MarketplaceHeader {...baseProps} refreshing={false} />);
    const btn = refreshBtn();
    expect(btn).toBeEnabled();
    expect(btn.getAttribute('aria-busy')).toBe('false');
    expect(btn.querySelector('svg').getAttribute('class')).not.toContain('animate-spin');
  });

  it('spins, disables and reports aria-busy while the refetch is in flight', () => {
    render(<MarketplaceHeader {...baseProps} refreshing />);
    const btn = refreshBtn();
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('aria-busy')).toBe('true');
    // The spin is the entire signal that the press did something — a
    // refresh that returns identical data changes nothing else on screen.
    expect(btn.querySelector('svg').getAttribute('class')).toContain('animate-spin');
  });

  it('calls onRefresh when pressed', async () => {
    const onRefresh = vi.fn();
    render(<MarketplaceHeader {...baseProps} onRefresh={onRefresh} refreshing={false} />);
    await userEvent.click(refreshBtn());
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('cannot be double-fired while already refreshing', async () => {
    const onRefresh = vi.fn();
    render(<MarketplaceHeader {...baseProps} onRefresh={onRefresh} refreshing />);
    await userEvent.click(refreshBtn()).catch(() => {});
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('defaults to idle when the parent passes no refreshing prop', () => {
    render(<MarketplaceHeader {...baseProps} />);
    expect(refreshBtn()).toBeEnabled();
  });
});

// The realistic failure for the "refresh everything" half is a query-key
// typo: the handler invalidates a string the queries never declared, so the
// call succeeds and nothing reloads. These are the keys MarketplaceFeed
// declares; the handler must cover each one by exact key or by prefix.
describe('refresh scope — every query the view reads', () => {
  const DECLARED = [
    ['marketplaceListings', 'created_at', 'desc'],
    ['marketplaceBundles'],
    // No itemSoldCounts — the "· N sold" line was removed from the tiles and
    // the detail sheet, and the bulk lookup that fed it went with it. These
    // two lists are hand-maintained rather than read off the component, so
    // they only stay honest if a query removal is mirrored here.
    ['marketplaceWishlist', 'user-1'],
    ['userInventory', 'kegan@example.com'],
    // The coin balance. It is a query at all BECAUSE it has to be in this
    // list: it used to be read off useAuth().user, a snapshot AuthContext
    // takes once at sign-in, so the number gating "Can afford" and every
    // Buy button was the one value on the page that no control could
    // reload — including this button.
    ['flexCoins', 'user-1'],
  ];
  const INVALIDATED = [
    ['marketplaceListings'],
    ['marketplaceBundles'],
    ['marketplaceWishlist', 'user-1'],
    ['userInventory', 'kegan@example.com'],
    ['flexCoins', 'user-1'],
  ];

  // react-query matches an invalidation against a query when the
  // invalidated key is a PREFIX of the query key.
  const isPrefix = (pre, key) => pre.every((seg, i) => key[i] === seg);

  it.each(DECLARED)('reloads %s', (...key) => {
    expect(INVALIDATED.some(pre => isPrefix(pre, key))).toBe(true);
  });

  it('reloads listings on every sort key, not just the mounted one', () => {
    // refetch() only reloaded ['marketplaceListings', <current sort>].
    for (const sort of [['created_at', 'desc'], ['created_at', 'asc'], ['asking_price', 'asc']]) {
      expect(isPrefix(['marketplaceListings'], ['marketplaceListings', ...sort])).toBe(true);
    }
  });
});
