// The Bag's Flex Coin balance must move when an item is sold.
//
// It used to render `user.flex_coins` from AuthContext, a bootstrap snapshot
// nothing on this screen refreshes, so the header kept the pre-sale number
// after every sale (audit 2026-09-30). It now reads ['flexCoins', id] and a
// sale writes the balance the sell_inventory_item RPC RETURNED into it.
//
// The server's balance is deliberately NOT the snapshot plus the sale price:
// migration 264's ledger trigger can clamp a credit, so a client sum can be
// wrong. The test pins that by returning a balance no client sum produces.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});

vi.mock('@/components/loot/RarityVisuals', () => ({
  RarityFrame: ({ children }) => <div>{children}</div>,
  RarityBadge: ({ rarity }) => <span>{rarity}</span>,
  rarityTint: () => '',
  COIN: '🪙',
}));
vi.mock('@/components/loot/CapsuleIcon', () => ({ default: () => <div /> }));
vi.mock('@/components/FlexCoinIcon', () => ({ default: () => <span /> }));
vi.mock('@/components/hub/CoinShopModal', () => ({ default: () => null }));
vi.mock('@/components/hub/StickerDisplay', () => ({ default: () => null }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));

const sellItem = vi.fn();
const getFlexCoins = vi.fn();
vi.mock('@/lib/data/inventory', () => ({
  listItems: () => Promise.resolve([
    { id: 'inv-1', item_id: 'st_1', item_type: 'sticker', item_name: 'Flame', item_rarity: 'common', is_listed: false },
  ]),
  sellItem: (...a) => sellItem(...a),
}));
vi.mock('@/lib/data/capsules', () => ({ listUnopenedCapsules: () => Promise.resolve([]) }));
vi.mock('@/lib/data/coinShop', () => ({ getFlexCoins: (...a) => getFlexCoins(...a) }));
vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));
vi.mock('@/api/profileCache', () => ({ patchProfile: vi.fn() }));
vi.mock('@/api/safeSelect', () => ({ safeSelect: vi.fn(() => Promise.resolve({ data: null, error: null })) }));
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'me@x.com', flex_coins: 100 } }),
}));
vi.mock('@/lib/ThemeContext', () => ({ useTheme: () => ({ lootThemeId: null, setLootThemeId: () => {} }) }));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));

const { default: UserBag } = await import('../UserBag');

function renderBag() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <UserBag open onClose={() => {}} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  sellItem.mockReset();
  getFlexCoins.mockReset();
});

describe('UserBag coin balance', () => {
  it('shows the live balance rather than the AuthContext snapshot', async () => {
    getFlexCoins.mockResolvedValue(240);
    renderBag();
    expect(await screen.findByText('240')).toBeInTheDocument();
    expect(screen.queryByText('100')).not.toBeInTheDocument();
  });

  it('shows the balance the server returned after a sale', async () => {
    // Before the sale the live read agrees with the snapshot; after it, the
    // refetch also reports the server's number.
    getFlexCoins.mockResolvedValueOnce(100).mockResolvedValue(103);
    // 103, not 100 + the sale price: the server clamped the credit.
    sellItem.mockResolvedValue({ coins: 3, newBalance: 103 });
    renderBag();
    expect(await screen.findByText('100')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /stickers/i }));
    const sell = await screen.findByRole('button', { name: /sell/i });
    fireEvent.click(sell);                                            // arm
    fireEvent.click(screen.getByRole('button', { name: /confirm sale/i })); // confirm

    await waitFor(() => expect(sellItem).toHaveBeenCalledWith('inv-1'));
    expect(await screen.findByText('103')).toBeInTheDocument();
  });
});
