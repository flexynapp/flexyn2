// src/components/market/__tests__/marketplaceSoldFade.test.jsx
//
// The sold-fade diffing effect in MarketplaceFeed, driven through a real
// render of the feed.
//
// The feature works by comparing the listings array against the previous one
// and treating anything that vanished as just-sold. That is only a safe
// inference when both arrays came from the SAME server query: listActive caps
// at 60 rows, so above the cap "newest 60" and "most expensive 60" are
// different PAGES of the same market, and a row present in one and absent
// from the other did not sell — it just isn't on this page.
//
// These tests exist because the guard for that case is easy to get subtly
// wrong: the sort key changes on the tap, while the data for the new sort
// arrives a render later, so a guard that resyncs on the key change alone
// still has the OLD page in hand when the NEW page lands.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Two pages of the same market, as listActive would return them above the
// 60-row cap. Ids 1-3 are only on the "newest" page, 6-8 only on "priciest";
// 4 and 5 are on both. Nothing here has sold.
const PAGE_RECENT = [1, 2, 3, 4, 5];
const PAGE_PRICE  = [4, 5, 6, 7, 8];

const row = (id) => ({
  id: `l${id}`, item_id: `i${id}`, inventory_id: `inv${id}`,
  item_name: `Item ${id}`, item_emoji: '🔥', item_rarity: 'common',
  listing_type: 'sale', asking_price: id * 10,
  seller_user_id: `s${id}`, seller_username: `seller${id}`,
});

let recentRows = PAGE_RECENT;
const listActive = vi.fn(async (_limit, sortBy) =>
  (sortBy === 'price' ? PAGE_PRICE : recentRows).map(row));

vi.mock('@/lib/data/marketplace', () => ({
  listActive: (...a) => listActive(...a),
  listActiveBundles: vi.fn(async () => []),
  purchaseListing: vi.fn(async () => ({})),
  purchaseBundle: vi.fn(async () => ({})),
  createListing: vi.fn(async () => ({})),
  cancelListing: vi.fn(async () => ({})),
}));
vi.mock('@/lib/data/inventory', () => ({ listItems: vi.fn(async () => []) }));
vi.mock('@/lib/data/itemSoldCounts', () => ({
  countsFor: vi.fn(async () => new Map()),
  formatSoldCount: () => '',
}));
vi.mock('@/lib/data/marketplaceWishlist', () => ({
  listMine: vi.fn(async () => []), toggle: vi.fn(async () => {}),
}));
vi.mock('@/lib/data/coinShop', () => ({ getFlexCoins: vi.fn(async () => 1000) }));
vi.mock('@/lib/recentlyViewedListings', () => ({ addRecentlyViewed: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', email: 'me@x.com', flex_coins: 1000 } }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

// The card is the assertion surface: it reports its id and whether it is
// rendering as a sold-fade tile.
vi.mock('../ListingCard', () => ({
  default: ({ listing, recentlySold, onCancel }) => (
    <div data-testid={`card-${listing.id}`} data-sold={recentlySold ? 'yes' : 'no'}>
      <button data-testid={`cancel-${listing.id}`} onClick={() => onCancel?.(listing)} />
    </div>
  ),
}));
vi.mock('../BundleCard', () => ({ default: () => null, bundlePrice: () => 0 }));
vi.mock('../MarketplaceHeader', () => ({ default: () => null }));
vi.mock('../TodayRail', () => ({ default: () => null }));
vi.mock('../ItemDetailSheet', () => ({ default: () => null }));
vi.mock('../ListItemDialog', () => ({ default: () => null }));
vi.mock('../TradeOfferDialog', () => ({ default: () => null }));
vi.mock('../BuyConfirmDialog', () => ({ default: () => null }));
vi.mock('@/components/hub/CoinShopModal', () => ({ default: () => null }));
vi.mock('@/components/hub/RecentlyViewedRail', () => ({ default: () => null }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  motion: new Proxy({}, {
    get: () => ({ children, ...p }) => {
      const { initial, animate, exit, transition, layout, ...rest } = p;
      return React.createElement('div', rest, children);
    },
  }),
}));

const { default: MarketplaceFeed } = await import('../MarketplaceFeed');

function renderFeed() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, refetchOnWindowFocus: false } },
  });
  const utils = render(
    <QueryClientProvider client={qc}><MarketplaceFeed /></QueryClientProvider>
  );
  return { ...utils, qc };
}

const soldCards = () =>
  [...document.querySelectorAll('[data-sold="yes"]')]
    .map(el => el.getAttribute('data-testid'));

beforeEach(() => { recentRows = PAGE_RECENT; listActive.mockClear(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('sold-fade — switching sort must not report a paging difference as a sale', () => {
  it('stamps nothing as SOLD when the sort changes', async () => {
    renderFeed();
    await screen.findByTestId('card-l1');

    // Change the sort exactly as the filter bar does.
    const select = screen.getByLabelText('Sort listings');
    await act(async () => {
      select.value = 'price-desc';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    // Wait for the priciest page to land.
    await screen.findByTestId('card-l8');

    // l1..l3 are absent from this page but did not sell. Nothing sold at all.
    expect(soldCards()).toEqual([]);
  });
});

describe('sold-fade — a stamped card must always clear itself', () => {
  it('clears after 5s even if the feed changes again inside the window', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { qc } = renderFeed();
    await screen.findByTestId('card-l1');

    // l5 sells.
    recentRows = [1, 2, 3, 4];
    await act(async () => { await qc.invalidateQueries({ queryKey: ['marketplaceListings'] }); });
    await waitFor(() => expect(soldCards()).toEqual(['card-l5']));

    // The feed changes again inside the 5s window, with nothing NEW sold —
    // someone else lists an item. This has to be a real change: an identical
    // refetch is absorbed by React Query's structural sharing, keeps the same
    // array identity, and never re-runs the effect at all.
    recentRows = [1, 2, 3, 4, 9];
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
    });
    await screen.findByTestId('card-l9');

    // Past the original 5s deadline, the stamp must be gone.
    await act(async () => { vi.advanceTimersByTime(6000); });
    await waitFor(() => expect(soldCards()).toEqual([]));
  });
});

describe('sold-fade — cancelling your own listing', () => {
  it('does not tell the seller it SOLD', async () => {
    // handleCancel pulls the listing and toasts "Pulled it back." The row
    // then vanishes from the feed, which the diff effect reads the only way
    // it can — as a disappearance — and stamps SOLD over it. Nothing sold.
    // The seller gets a toast and a stamp that contradict each other.
    const { qc } = renderFeed();
    await screen.findByTestId('card-l3');

    recentRows = [1, 2, 4, 5];
    await act(async () => {
      screen.getByTestId('cancel-l3').click();
      await qc.invalidateQueries({ queryKey: ['marketplaceListings'] });
    });

    // It simply leaves. No stamp — the toast already says what happened, and
    // "SOLD" would be a false statement to the one person who knows it isn't.
    await waitFor(() => expect(screen.queryByTestId('card-l3')).toBeNull());
    expect(soldCards()).toEqual([]);
  });
});
