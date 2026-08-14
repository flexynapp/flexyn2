// The seller's bundle dialog, at the level the seller experiences it.
//
// The preview block is the reason this screen exists. Migration 320 moved the
// discount onto the seller — purchase_bundle credits them exactly what the
// buyer paid, where it used to credit every listing's full asking_price and
// mint the difference. Nobody is told that by the schema, so the dialog has
// to say it, and "the dialog says it" is a claim worth a test: a refactor
// that dropped the You-receive row would leave a screen that looks complete
// and quietly costs sellers money.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// These components now read tFallback, and useLanguage() throws outside a
// provider by design. Resolving the real English catalog rather than returning
// key paths, so any assertion here still reads like the screen.
vi.mock('@/lib/LanguageContext', async () => {
  const { languageMock } = await import('@/lib/__tests__/i18nMock');
  return languageMock();
});


// The Proxy has to CACHE per tag. The one-liner version used elsewhere in
// this folder — `get: () => ({children, ...p}) => <div>…</div>` — mints a new
// function component on every property access, so `motion.div` is a different
// component TYPE on every render and React unmounts and remounts the whole
// subtree each time. Harmless for tests that only read static output; fatal
// here, because remounting throws away the text input mid-type: "Fire set"
// arrived as "F". Worth knowing before copying that mock into a test that
// types anything.
vi.mock('framer-motion', () => {
  const cache = {};
  const tagged = (tag) => (cache[tag] ??= ({ children, ...p }) => <div {...p}>{children}</div>);
  return { motion: new Proxy({}, { get: (_t, tag) => tagged(tag) }) };
});
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
// CoinAmount reaches through useNumberFormatter to LanguageContext, which
// this dialog has no business providing. Identity formatting keeps the
// assertions about the ARITHMETIC rather than about thousands separators.
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const toastError   = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/lib/toast', () => ({ toast: { error: (...a) => toastError(...a), success: (...a) => toastSuccess(...a) } }));

// quoteBundle and the constants stay REAL — the preview arithmetic is what's
// under test. Only the network call is stubbed.
const createBundle = vi.fn();
vi.mock('@/lib/data/marketplaceBundles', async (importOriginal) => ({
  ...(await importOriginal()),
  createBundle: (...a) => createBundle(...a),
}));

const CreateBundleDialog = (await import('../CreateBundleDialog')).default;

const listing = (id, price, name) => ({
  id, asking_price: price, item_name: name, item_emoji: '🔥',
  item_rarity: 'common', listing_type: 'sale',
});

const LISTINGS = [listing('a', 400, 'Alpha'), listing('b', 600, 'Beta'), listing('c', 100, 'Gamma')];
const user = { id: 'u1', email: 'seller@example.com' };

const setup = (props = {}) => render(
  <CreateBundleDialog open onClose={vi.fn()} listings={LISTINGS} user={user} {...props} />
);

beforeEach(() => { cleanup(); vi.clearAllMocks(); createBundle.mockResolvedValue({ id: 'b1' }); });

const pick = async (names) => {
  for (const n of names) await userEvent.click(screen.getByText(n));
};

describe('picking listings', () => {
  it('will not continue with fewer than two, and says how many more', async () => {
    setup();
    expect(screen.getByRole('button', { name: /pick 2 more/i })).toBeDisabled();
    await pick(['Alpha']);
    expect(screen.getByRole('button', { name: /pick 1 more/i })).toBeDisabled();
    await pick(['Beta']);
    expect(screen.getByRole('button', { name: /continue with 2 items/i })).toBeEnabled();
  });

  it('tells a seller with too few listings why they cannot bundle', () => {
    setup({ listings: [LISTINGS[0]] });
    expect(screen.getByText(/at least 2 live sale listings/i)).toBeInTheDocument();
  });
});

describe('the preview — what the seller actually gets', () => {
  const toConfigure = async () => {
    setup();
    await pick(['Alpha', 'Beta']);            // 400 + 600 = 1000
    await userEvent.click(screen.getByRole('button', { name: /continue with 2 items/i }));
  };

  const rowValue = (label) => {
    const row = screen.getByText(label).closest('div');
    return within(row).getAllByText(/\d/).map(n => n.textContent).join(' ');
  };

  it('shows the listed total, the buyer price and the seller take at 25%', async () => {
    await toConfigure();
    expect(rowValue('Listed separately')).toMatch(/1,?000/);
    expect(rowValue('Buyer pays')).toMatch(/750/);
    expect(rowValue('You receive')).toMatch(/750/);
  });

  it('states that the discount comes out of the seller, with the amount', async () => {
    await toConfigure();
    expect(screen.getByText(/discount comes out of your share/i)).toBeInTheDocument();
    expect(screen.getByText(/giving up/i)).toBeInTheDocument();
  });

  it('recomputes when the discount changes', async () => {
    await toConfigure();
    await userEvent.click(screen.getByRole('button', { name: '50%' }));
    expect(rowValue('Buyer pays')).toMatch(/500/);
    expect(rowValue('You receive')).toMatch(/500/);
  });

  it('You receive never exceeds Buyer pays — the seller funds the discount', async () => {
    await toConfigure();
    for (const pct of ['10%', '25%', '50%', '75%']) {
      await userEvent.click(screen.getByRole('button', { name: pct }));
      expect(rowValue('You receive')).toBe(rowValue('Buyer pays'));
    }
  });
});

describe('submitting', () => {
  const toConfigure = async () => {
    setup();
    await pick(['Alpha', 'Beta']);
    await userEvent.click(screen.getByRole('button', { name: /continue with 2 items/i }));
  };

  it('passes the picked ids, the discount and the seller through', async () => {
    await toConfigure();
    await userEvent.type(screen.getByPlaceholderText(/starter pack/i), 'Fire set');
    await userEvent.click(screen.getByRole('button', { name: /create bundle/i }));
    expect(createBundle).toHaveBeenCalledWith({
      title: 'Fire set', discountPct: 25, listingIds: ['a', 'b'],
      sellerUserId: 'u1', sellerEmail: 'seller@example.com',
    });
  });

  it('blocks an unnamed bundle before any network call', async () => {
    await toConfigure();
    expect(screen.getByRole('button', { name: /create bundle/i })).toBeDisabled();
    expect(createBundle).not.toHaveBeenCalled();
  });

  it('runs the title through the profanity filter — it is the only free text a seller can put in front of everyone else', async () => {
    await toConfigure();
    await userEvent.type(screen.getByPlaceholderText(/starter pack/i), 'fucking deal');
    await userEvent.click(screen.getByRole('button', { name: /create bundle/i }));
    expect(createBundle).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalled();
  });

  it('explains a listing that moved underneath the seller instead of "try again"', async () => {
    createBundle.mockRejectedValue(new Error('not_your_listing'));
    await toConfigure();
    await userEvent.type(screen.getByPlaceholderText(/starter pack/i), 'Fire set');
    await userEvent.click(screen.getByRole('button', { name: /create bundle/i }));
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/isn't yours any more/i));
  });
});
