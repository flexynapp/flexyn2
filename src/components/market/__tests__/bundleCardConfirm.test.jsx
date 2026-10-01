// Buying a bundle takes two taps, the same Buy → Confirm shape as a single
// listing in ItemDetailSheet. It used to spend Flex Coins on the first tap,
// the only purchase in the app with no second look.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));
vi.mock('@/lib/listMotion', () => ({ listItemMotion: () => ({}) }));

const BundleCard = (await import('../BundleCard')).default;

const bundle = { id: 'b1', title: 'Fire set', discount_pct: 10, seller_user_id: 'seller' };
const listings = [
  { id: 'l1', listing_type: 'sale', asking_price: 100, item_emoji: '🔥', item_rarity: 'common', username: 'sam' },
  { id: 'l2', listing_type: 'sale', asking_price: 100, item_emoji: '💧', item_rarity: 'common', username: 'sam' },
];

const show = (onBuyBundle, flexCoins = 1000) => render(
  <BundleCard
    bundle={bundle}
    listings={listings}
    currentUser={{ id: 'me' }}
    flexCoins={flexCoins}
    onBuyBundle={onBuyBundle}
  />,
);

afterEach(cleanup);

describe('BundleCard buy confirm', () => {
  it('first tap arms the confirm step and spends nothing', async () => {
    const onBuyBundle = vi.fn().mockResolvedValue(true);
    show(onBuyBundle);
    await userEvent.click(screen.getByRole('button', { name: /buy bundle/i }));
    expect(onBuyBundle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Confirm 180' })).toBeTruthy();
    // The balance after purchase, as ItemDetailSheet shows it.
    expect(screen.getByText('After this you have')).toBeTruthy();
    expect(screen.getByText('820')).toBeTruthy();
  });

  it('second tap buys', async () => {
    const onBuyBundle = vi.fn().mockResolvedValue(true);
    show(onBuyBundle);
    await userEvent.click(screen.getByRole('button', { name: /buy bundle/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm 180' }));
    expect(onBuyBundle).toHaveBeenCalledTimes(1);
    expect(onBuyBundle).toHaveBeenCalledWith(bundle, listings, 180);
  });

  it('Cancel backs out without buying', async () => {
    const onBuyBundle = vi.fn();
    show(onBuyBundle);
    await userEvent.click(screen.getByRole('button', { name: /buy bundle/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onBuyBundle).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /buy bundle/i })).toBeTruthy();
  });

  it('a failed purchase drops back to Buy rather than staying armed', async () => {
    const onBuyBundle = vi.fn().mockResolvedValue(false);
    show(onBuyBundle);
    await userEvent.click(screen.getByRole('button', { name: /buy bundle/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Confirm 180' }));
    expect(await screen.findByRole('button', { name: /buy bundle/i })).toBeTruthy();
  });

  it('cannot be armed when unaffordable', async () => {
    const onBuyBundle = vi.fn();
    show(onBuyBundle, 50);
    const btn = screen.getByRole('button', { name: /buy bundle/i });
    expect(btn.disabled).toBe(true);
  });

  it('interpolates the byline and badge rather than rendering placeholders', () => {
    show(vi.fn());
    expect(screen.getByText('by sam · 2 items')).toBeTruthy();
    expect(screen.getByText(/Bundle · 10% off/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\{\w+\}/);
  });
});
