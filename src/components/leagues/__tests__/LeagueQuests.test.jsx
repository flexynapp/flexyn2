import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({ get: vi.fn(), claim: vi.fn() }));
vi.mock('@/lib/data/leaguePoints', () => ({
  getMyLeagueQuests: h.get,
  claimLeagueQuest: h.claim,
}));
vi.mock('@/lib/haptic', () => ({ triggerHaptic: vi.fn() }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

import LeagueQuests from '../LeagueQuests';

const interp = (s, vars = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
const tFallback = (_key, english, vars) => interp(english, vars);
const t = (k) => (k === 'dashboard.claim' ? 'Claim' : k);
const fmt = (n) => String(n);

function show() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(qc, 'invalidateQueries');
  render(
    <QueryClientProvider client={qc}>
      <LeagueQuests userId="u1" t={t} tFallback={tFallback} fmt={fmt} />
    </QueryClientProvider>,
  );
  return spy;
}

describe('LeagueQuests', () => {
  beforeEach(() => { h.get.mockReset(); h.claim.mockReset(); });

  it('shows server progress and offers Claim only on a met, unclaimed quest', async () => {
    h.get.mockResolvedValue({ quests: [
      { quest_id: 'train_2', target: 2, xp: 100, progress: 2, claimed: false },
      { quest_id: 'train_4', target: 4, xp: 200, progress: 2, claimed: false },
      { quest_id: 'bounty_1', target: 1, xp: 100, progress: 1, claimed: true, xp_awarded: 100 },
    ] });
    show();
    await screen.findByText('Train 4 days');
    expect(screen.getByText('2 of 4')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Claim' })).toHaveLength(1);
    expect(screen.getByText('100 XP this week')).toBeInTheDocument();
  });

  it('claims through the server and refreshes the standings', async () => {
    h.get.mockResolvedValue({ quests: [
      { quest_id: 'train_2', target: 2, xp: 100, progress: 2, claimed: false },
    ] });
    h.claim.mockResolvedValue({ success: true, xp_awarded: 100 });
    const spy = show();
    fireEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    await waitFor(() => expect(h.claim).toHaveBeenCalledWith('train_2'));
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['myLeague', 'u1'] }));
  });

  it('says so on the row when a claim fails', async () => {
    h.get.mockResolvedValue({ quests: [
      { quest_id: 'cardio_2', target: 2, xp: 100, progress: 2, claimed: false },
    ] });
    h.claim.mockRejectedValue(new Error('network'));
    show();
    fireEvent.click(await screen.findByRole('button', { name: 'Claim' }));
    expect(await screen.findByText('Could not claim. Try again.')).toBeInTheDocument();
  });

  it('renders nothing on a host without the migration', async () => {
    h.get.mockResolvedValue(null);
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <LeagueQuests userId="u1" t={t} tFallback={tFallback} fmt={fmt} />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(h.get).toHaveBeenCalled());
    expect(container.querySelector('section')).toBeNull();
  });
});
