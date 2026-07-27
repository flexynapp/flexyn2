// Tests for the redeem half of ReferralSheet — the capability this added.
//
// `claimReferral` has existed since migration 089 but only ever fired
// automatically from a `?ref=` link at signup, so none of its failure
// reasons had ever been surfaced to a user before. Each one now maps to
// its own message, and getting that mapping wrong means a person retrying
// a code that will never work.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ReferralSheet from '../ReferralSheet';

const claimReferral = vi.fn();
const toastError = vi.fn();
const toastSuccess = vi.fn();

vi.mock('@/lib/data/referrals', () => ({ claimReferral: (...a) => claimReferral(...a) }));
vi.mock('@/lib/toast', () => ({
  toast: { error: (...a) => toastError(...a), success: (...a) => toastSuccess(...a) },
}));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ tFallback: (_k, fb) => fb }),
}));
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));

function renderSheet(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ReferralSheet
        open
        onClose={vi.fn()}
        code="ABC123"
        count={0}
        coins={0}
        onCopy={vi.fn()}
        onShare={vi.fn()}
        copied={false}
        {...props}
      />
    </QueryClientProvider>
  );
}

const input = () => screen.getByLabelText(/Got a friend/i);
const redeemBtn = () => screen.getByRole('button', { name: /Redeem/i });

beforeEach(() => {
  claimReferral.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

describe('ReferralSheet — code entry', () => {
  it('normalises what people actually type', () => {
    renderSheet();
    // Codes get read aloud, texted, and written down. Lowercase, spaces and
    // dashes are all things a real person will produce.
    fireEvent.change(input(), { target: { value: 'abc-123' } });
    expect(input().value).toBe('ABC123');
  });

  it('caps entry at the 6 characters the generator produces', () => {
    renderSheet();
    fireEvent.change(input(), { target: { value: 'ABCDEFGHIJ' } });
    expect(input().value).toBe('ABCDEF');
  });

  it('keeps redeem disabled until the code is complete', () => {
    renderSheet();
    expect(redeemBtn()).toBeDisabled();
    fireEvent.change(input(), { target: { value: 'ABC12' } });
    expect(redeemBtn()).toBeDisabled();
    fireEvent.change(input(), { target: { value: 'ABC123' } });
    expect(redeemBtn()).not.toBeDisabled();
  });

  it('submits on Enter', async () => {
    claimReferral.mockResolvedValue({ ok: true });
    renderSheet();
    fireEvent.change(input(), { target: { value: 'ABC123' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    await waitFor(() => expect(claimReferral).toHaveBeenCalledWith('ABC123'));
  });
});

describe('ReferralSheet — claim outcomes', () => {
  it('confirms success and swaps the field for a receipt', async () => {
    claimReferral.mockResolvedValue({ ok: true });
    renderSheet();
    fireEvent.change(input(), { target: { value: 'ABC123' } });
    fireEvent.click(redeemBtn());
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    // The field goes away so a user can't sit there re-submitting a code
    // the server will now reject as already_claimed.
    await waitFor(() => expect(screen.queryByLabelText(/Got a friend/i)).toBeNull());
    expect(screen.getByText(/Code applied/i)).toBeTruthy();
  });

  it.each([
    ['code_not_found',  /No one has that code/i],
    ['already_claimed', /already used an invite code/i],
    ['self_referral',   /your own code/i],
    ['invalid_code',    /doesn't look right/i],
  ])('explains %s specifically', async (reason, pattern) => {
    claimReferral.mockResolvedValue({ ok: false, reason });
    renderSheet();
    fireEvent.change(input(), { target: { value: 'ABC123' } });
    fireEvent.click(redeemBtn());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(pattern);
    // The field stays put on failure — a typo should be correctable in place.
    expect(screen.getByLabelText(/Got a friend/i)).toBeTruthy();
  });

  it('says so plainly when the RPC is not deployed', async () => {
    // referrals.js returns null on 42883/42P01. Without this branch the user
    // gets a generic "try again" for something retrying can never fix.
    claimReferral.mockResolvedValue(null);
    renderSheet();
    fireEvent.change(input(), { target: { value: 'ABC123' } });
    fireEvent.click(redeemBtn());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/aren't enabled on this build/i);
  });

  it('falls back to a generic message for an unmapped reason', async () => {
    claimReferral.mockResolvedValue({ ok: false, reason: 'rpc_error' });
    renderSheet();
    fireEvent.change(input(), { target: { value: 'ABC123' } });
    fireEvent.click(redeemBtn());
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/Could not apply that code/i);
  });
});

describe('ReferralSheet — restore', () => {
  it('offers a way back only when the card is hidden', () => {
    const { rerender } = renderSheet({ cardHidden: false });
    expect(screen.queryByText(/Show the full card/i)).toBeNull();

    const onRestoreCard = vi.fn();
    const onClose = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(
      <QueryClientProvider client={qc}>
        <ReferralSheet
          open onClose={onClose} code="ABC123" count={0} coins={0}
          onCopy={vi.fn()} onShare={vi.fn()} copied={false}
          cardHidden onRestoreCard={onRestoreCard}
        />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByText(/Show the full card/i));
    expect(onRestoreCard).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
