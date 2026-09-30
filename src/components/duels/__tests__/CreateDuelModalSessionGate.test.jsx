// A Session Duel is refused by the server for a private profile you do not
// follow and for anyone with no workout to copy. The picker must say so
// before the tap, not after it (duels audit, round three).

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const candidates = vi.fn();
vi.mock('@/lib/data/duels', () => ({
  createDuel: vi.fn(),
  createSessionDuel: vi.fn(),
  getFrequentOpponents: vi.fn(async () => []),
  getMatchedDuelOpponents: vi.fn(async () => []),
  sendDuelDM: vi.fn(),
  duelErrorMessage: () => 'error',
  searchDuelOpponents: (...a) => candidates(...a),
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

function show(props) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CreateDuelModal onClose={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

const sessionButton = () => screen.getByRole('button', { name: /Session Duel/ });
const openButton = () => screen.getByRole('button', { name: /Open Duel/ });

describe('CreateDuelModal Session Duel gate', () => {
  beforeEach(() => candidates.mockReset());

  it('disables Session and falls back to Open when the server says no', async () => {
    candidates.mockResolvedValue([{ id: 'sam', username: 'sam', session_ok: false }]);
    show({ opponentId: 'sam', opponentUsername: 'sam' });
    await screen.findByText('They have no workout you can take on.');
    expect(sessionButton()).toBeDisabled();
    expect(openButton()).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps Session as the default when it is playable', async () => {
    candidates.mockResolvedValue([{ id: 'sam', username: 'sam', session_ok: true }]);
    show({ opponentId: 'sam', opponentUsername: 'sam' });
    await vi.waitFor(() => expect(candidates).toHaveBeenCalledWith('sam'));
    expect(sessionButton()).not.toBeDisabled();
    expect(sessionButton()).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('They have no workout you can take on.')).toBeNull();
  });
});
