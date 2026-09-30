// The picker lists people close to your strength (duel_matched_opponents,
// migration 20261001030000) above the people you follow, and never lists
// the same person twice.

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const matched = vi.fn();
vi.mock('@/lib/data/duels', () => ({
  createDuel: vi.fn(),
  createSessionDuel: vi.fn(),
  getFrequentOpponents: vi.fn(async () => []),
  getMatchedDuelOpponents: (...a) => matched(...a),
  sendDuelDM: vi.fn(),
  duelErrorMessage: () => 'error',
  searchDuelOpponents: vi.fn(async () => [
    { id: 'ana', username: 'ana', session_ok: true },
    { id: 'bo',  username: 'bo',  session_ok: true },
  ]),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/haptic', () => ({ haptic: vi.fn() }));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, en, vars) => String(en).replace(/\{(\w+)\}/g, (_, n) => vars?.[n] ?? `{${n}}`),
  }),
}));

const { default: CreateDuelModal } = await import('@/components/duels/CreateDuelModal');

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreateDuelModal onClose={() => {}} />
    </QueryClientProvider>,
  );
}

const section = (title) => screen.getByText(title).parentElement;

describe('CreateDuelModal close-to-your-strength list', () => {
  it('shows matched opponents first and drops them from the follow list', async () => {
    matched.mockResolvedValue([{ id: 'bo', username: 'bo', session_ok: true, match_step: 1 }]);
    show();
    await screen.findByText('Close to your strength');
    await screen.findByText('People you follow');
    expect(within(section('Close to your strength')).getByText(/bo/)).toBeTruthy();
    expect(within(section('People you follow')).queryByText(/^@?bo$/)).toBeNull();
    expect(within(section('People you follow')).getByText(/ana/)).toBeTruthy();
  });

  it('leaves the section out when nobody is close', async () => {
    matched.mockResolvedValue([]);
    show();
    await screen.findByText('People you follow');
    expect(screen.queryByText('Close to your strength')).toBeNull();
  });
});
