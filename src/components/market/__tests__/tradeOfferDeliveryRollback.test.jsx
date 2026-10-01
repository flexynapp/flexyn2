// create_trade_offer escrows the offered sticker BEFORE the DM goes out. If
// the DM step then fails, the offer has to be withdrawn, or the seller is
// never told and the sender's sticker stays locked behind an offer they were
// told had failed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});
vi.mock('framer-motion', () => {
  const cache = {};
  const tagged = (tag) => (cache[tag] ??= ({ children, ...p }) => <div {...p}>{children}</div>);
  return { motion: new Proxy({}, { get: (_t, tag) => tagged(tag) }) };
});
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/components/loot/RarityVisuals', () => ({
  RarityBadge: () => null,
  RarityFrame: ({ children, as: _as, glow: _g, rarity: _r, ...p }) => <button {...p}>{children}</button>,
}));

const toastError   = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: { error: (...a) => toastError(...a), success: (...a) => toastSuccess(...a) } }));

const findOrCreateConversation = vi.fn();
const sendMessage = vi.fn();
vi.mock('@/lib/data/hubMessages', () => ({
  findOrCreateConversation: (...a) => findOrCreateConversation(...a),
  sendMessage: (...a) => sendMessage(...a),
}));

const createOffer = vi.fn();
const cancel = vi.fn();
vi.mock('@/lib/data/tradeOffers', () => ({
  createOffer: (...a) => createOffer(...a),
  cancel: (...a) => cancel(...a),
  tradeErrorMessage: () => 'Trade failed',
}));

const TradeOfferDialog = (await import('../TradeOfferDialog')).default;

const listing = {
  id: 'listing-1', inventory_id: 'inv-theirs', seller_user_id: 'seller-uuid',
  item_id: 'cat', item_name: 'Cat', item_emoji: '🐱', item_rarity: 'common', asking_price: 50,
};
const userItems = [
  { id: 'inv-mine', item_id: 'dog', item_name: 'Dog', item_emoji: '🐶', item_rarity: 'common', item_type: 'sticker', is_listed: false },
];
const user = { id: 'me-uuid', email: 'me@example.com', username: 'me' };

const send = async (onClose = vi.fn()) => {
  render(<TradeOfferDialog open listing={listing} userItems={userItems} user={user} onClose={onClose} />);
  await userEvent.click(screen.getByRole('button', { name: /dog/i }));
  await userEvent.click(screen.getByRole('button', { name: /send trade offer/i }));
  return onClose;
};

beforeEach(() => {
  vi.clearAllMocks();
  createOffer.mockResolvedValue('offer-1');
  findOrCreateConversation.mockResolvedValue({ id: 'conv-1' });
  sendMessage.mockResolvedValue({ id: 'msg-1' });
  cancel.mockResolvedValue({ status: 'cancelled' });
});
afterEach(cleanup);

describe('TradeOfferDialog delivery failure', () => {
  it('withdraws the escrowed offer when the DM fails to send', async () => {
    sendMessage.mockRejectedValue(new Error('network'));
    const onClose = await send();
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('offer-1'));
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError.mock.calls[0][0]).toMatch(/withdrawn/);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('withdraws when the conversation cannot be opened', async () => {
    findOrCreateConversation.mockResolvedValue(null);
    await send();
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('offer-1'));
  });

  it('treats a null sendMessage result as a failed delivery', async () => {
    sendMessage.mockResolvedValue(null);
    await send();
    await waitFor(() => expect(cancel).toHaveBeenCalledWith('offer-1'));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('points at Trade history when the withdrawal itself fails', async () => {
    sendMessage.mockRejectedValue(new Error('network'));
    cancel.mockRejectedValue(new Error('network'));
    await send();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/Trade history/);
  });

  it('does not cancel anything when the offer was never created', async () => {
    createOffer.mockRejectedValue(new Error('offer_item_in_escrow'));
    await send();
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Trade failed'));
    expect(cancel).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('a delivered offer is not withdrawn', async () => {
    const onClose = await send();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(cancel).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
