// The sign-in gate has to say when the address already has an account.
//
// Magic links sign up and sign in with the same tap, so the old screen showed
// one "check your inbox" for both — someone entering the email they already
// use got no signal at all, on a screen headed "Let's get you set up".

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

const signInWithMagicLink = vi.fn();

vi.mock('@/api/db', () => ({
  db: { auth: { signInWithMagicLink: (...a) => signInWithMagicLink(...a), signInAsGuest: vi.fn(), signInWithProvider: vi.fn() } },
}));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const { default: SignInToContinue } = await import('../SignInToContinue');

async function submitEmail(address) {
  render(<SignInToContinue />);
  await userEvent.type(screen.getByPlaceholderText('you@example.com'), address);
  await userEvent.click(screen.getByRole('button', { name: /send magic link/i }));
}

describe('SignInToContinue — existing account', () => {
  beforeEach(() => signInWithMagicLink.mockReset());

  it('warns that the account already exists', async () => {
    signInWithMagicLink.mockResolvedValue({ ok: true, isNewAccount: false });

    await submitEmail('kegan@example.com');

    expect(await screen.findByText(/already have a Flexyn account/i)).toBeTruthy();
    // And it says what the link in their inbox will do, since that link IS
    // the sign-in — there is no second button to press.
    expect(screen.getByText(/sign-in link to/i)).toBeTruthy();
    expect(screen.getAllByText('kegan@example.com').length).toBeGreaterThan(0);
  });

  it('keeps the plain confirmation for a brand-new account', async () => {
    signInWithMagicLink.mockResolvedValue({ ok: true, isNewAccount: true });

    await submitEmail('new@example.com');

    expect(await screen.findByText(/Check your inbox/i)).toBeTruthy();
    expect(screen.queryByText(/already have a Flexyn account/i)).toBeNull();
  });

  it('drops the warning when they correct the address', async () => {
    signInWithMagicLink.mockResolvedValue({ ok: true, isNewAccount: false });

    await submitEmail('kegan@example.com');
    expect(await screen.findByText(/already have a Flexyn account/i)).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /wrong email/i }));

    expect(screen.queryByText(/already have a Flexyn account/i)).toBeNull();
    expect(screen.getByPlaceholderText('you@example.com')).toBeTruthy();
  });
});
