// Render tests for the round 2 capsule and market screens: the Capsules home,
// the sticker set sheet and the listing detail. They pin the behaviour that
// matters beyond the look: the page opens what is on the shelf and buys only
// through the shop RPC, the sheet reports real ownership, and the detail
// screen asks before it spends.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});

const USER = { id: 'u1', email: 'lifter@example.com' };
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: USER }) }));

const listUnopenedCapsules = vi.fn();
const getPity = vi.fn();
vi.mock('@/lib/data/capsules', () => ({
  listUnopenedCapsules: (...a) => listUnopenedCapsules(...a),
  getPity: (...a) => getPity(...a),
}));

const listItems = vi.fn();
vi.mock('@/lib/data/inventory', () => ({ listItems: (...a) => listItems(...a) }));

const getFlexCoins = vi.fn();
const purchaseItem = vi.fn();
vi.mock('@/lib/data/coinShop', async (importOriginal) => ({
  ...(await importOriginal()),
  getFlexCoins: (...a) => getFlexCoins(...a),
  purchaseItem: (...a) => purchaseItem(...a),
}));

const priceStatsForItem = vi.fn();
vi.mock('@/lib/data/marketplace', () => ({
  priceStatsForItem: (...a) => priceStatsForItem(...a),
}));

const requestOpenCapsules = vi.fn();
vi.mock('@/lib/inventoryFlow', () => ({
  requestOpenCapsules: (...a) => requestOpenCapsules(...a),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const Capsules = (await import('../Capsules')).default;
const StickerSet = (await import('../StickerSet')).default;
const ItemDetailSheet = (await import('@/components/market/ItemDetailSheet')).default;
const { stickerSet } = await import('@/lib/capsuleShelf');

function wrap(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

const cap = (id, capsule_type) => ({ id, capsule_type, is_opened: false });

beforeEach(() => {
  [listUnopenedCapsules, getPity, listItems, getFlexCoins, purchaseItem,
    priceStatsForItem, requestOpenCapsules].forEach(m => m.mockReset());
  getPity.mockResolvedValue({ since_epic: 4, epic_at: 20 });
  listItems.mockResolvedValue([]);
  getFlexCoins.mockResolvedValue(500);
  priceStatsForItem.mockResolvedValue({ count: 0, recent: [] });
});

describe('Capsules', () => {
  it('starts on the rarest tier on the shelf and opens from it', async () => {
    listUnopenedCapsules.mockResolvedValue([cap('s1', 'standard'), cap('e1', 'elite'), cap('e2', 'elite')]);
    wrap(<Capsules />);
    const open = await screen.findByRole('button', { name: 'Open elite' });
    fireEvent.click(open);
    expect(requestOpenCapsules).toHaveBeenCalledWith([expect.objectContaining({ id: 'e1' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Open all 2 at once' }));
    expect(requestOpenCapsules).toHaveBeenLastCalledWith([
      expect.objectContaining({ id: 'e1' }), expect.objectContaining({ id: 'e2' }),
    ]);
  });

  it('shows the published odds for the selected tier', async () => {
    listUnopenedCapsules.mockResolvedValue([]);
    wrap(<Capsules />);
    await screen.findByText('Drop rates');
    // Standard's epic rate, from CAPSULE_ODDS, not a number typed into the page.
    expect(screen.getAllByText(/1\.8%/).length).toBeGreaterThan(0);
  });

  it('asks before buying, and buys only through the shop', async () => {
    listUnopenedCapsules.mockResolvedValue([]);
    purchaseItem.mockResolvedValue({ success: true, newBalance: 400 });
    wrap(<Capsules />);
    const buy = await screen.findByRole('button', { name: /Buy for/ });
    await waitFor(() => expect(buy).not.toBeDisabled());
    fireEvent.click(buy);
    expect(purchaseItem).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: /Confirm, spend/ }));
    await waitFor(() => expect(purchaseItem).toHaveBeenCalledWith(USER, 'capsule_standard'));
  });

  it('will not offer a buy the balance cannot cover', async () => {
    listUnopenedCapsules.mockResolvedValue([]);
    getFlexCoins.mockResolvedValue(10);
    wrap(<Capsules />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Buy for/ })).toBeDisabled());
  });
});

describe('StickerSet', () => {
  it('counts what the inventory holds and shows only those up top', async () => {
    const set = stickerSet();
    listItems.mockResolvedValue([{ item_id: set[0].id }, { item_id: set[0].id }, { item_id: set[1].id }]);
    wrap(<StickerSet />);
    expect(await screen.findByText(`2 of ${set.length} stickers`)).toBeInTheDocument();
    // Two owned stickers on the panel, not the whole sheet.
    const mine = screen.getAllByRole('button').filter(b => b.hasAttribute('aria-pressed'));
    expect(mine.map(b => b.getAttribute('aria-label')).sort()).toEqual([set[0].name, set[1].name].sort());
    // Nothing is laid out per sticker until a rarity is opened.
    expect(screen.queryAllByText(/Not collected yet/)).toHaveLength(0);
  });

  it('tapping a sticker names it', async () => {
    const set = stickerSet();
    listItems.mockResolvedValue([{ item_id: set[0].id }, { item_id: set[1].id }]);
    wrap(<StickerSet />);
    const first = await screen.findByRole('button', { name: set[0].name });
    fireEvent.click(first);
    expect(first).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText(set[0].name, { selector: 'span' })).toBeInTheDocument();
  });

  it('says so when nothing is owned', async () => {
    listItems.mockResolvedValue([]);
    wrap(<StickerSet />);
    expect(await screen.findByText(/No stickers yet/)).toBeInTheDocument();
  });

  it('opens one rarity at a time, with the missing ones marked', async () => {
    const set = stickerSet();
    const common = set.filter(s => s.rarity === 'common');
    listItems.mockResolvedValue([{ item_id: common[0].id }]);
    wrap(<StickerSet />);
    await screen.findByText(`1 of ${set.length} stickers`);
    const row = screen.getByRole('button', { name: /Common/, expanded: false });
    expect(row).toHaveTextContent(`1 of ${common.length}`);
    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getAllByText(/Not collected yet/)).toHaveLength(common.length - 1);
    fireEvent.click(row);
    expect(screen.queryAllByText(/Not collected yet/)).toHaveLength(0);
  });
});

describe('ItemDetailSheet', () => {
  const sticker = stickerSet()[0];
  const listing = {
    id: 'l1', item_id: sticker.id, item_name: sticker.name, item_emoji: sticker.emoji,
    item_rarity: sticker.rarity, listing_type: 'sale', asking_price: 120,
    seller_user_id: 'other', seller_username: 'seller',
  };

  it('confirms with the balance left before it spends', async () => {
    const onBuyConfirm = vi.fn().mockResolvedValue(true);
    wrap(<ItemDetailSheet listing={listing} currentUser={USER} flexCoins={500}
      onBuyConfirm={onBuyConfirm} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Buy for/ }));
    expect(onBuyConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('After this you have')).toBeInTheDocument();
    expect(screen.getByText('380')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Confirm/ }));
    await waitFor(() => expect(onBuyConfirm).toHaveBeenCalledWith(listing));
    expect(await screen.findByText('Bought')).toBeInTheDocument();
  });

  it('says what is short instead of offering a buy', () => {
    wrap(<ItemDetailSheet listing={listing} currentUser={USER} flexCoins={100}
      onBuyConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('You need 20 more')).toBeInTheDocument();
  });

  it('never offers to buy your own listing', () => {
    wrap(<ItemDetailSheet listing={{ ...listing, seller_user_id: USER.id }} currentUser={USER}
      flexCoins={500} onBuyConfirm={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText('This is your listing.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Buy for/ })).toBeNull();
  });
});
