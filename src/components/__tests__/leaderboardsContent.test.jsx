// Render tests for the two affordances that only appear on a full board:
// the "Show all" expander and the out-of-top-100 rank row. Production has 8
// ranked athletes, so neither can be exercised by hand — these drive the
// component with 120 mock rows instead.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockRows = (n) => Array.from({ length: n }, (_, i) => ({
  user_id: `u${i + 1}`,
  full_name: `Athlete ${i + 1}`,
  username: `a${i + 1}`,
  rank: i + 1,
  value: String(10000 - i * 10),
}));

let globalRankValue = { rank: null, value: null, ahead: null, gap: null, isLoading: false, supported: true };

vi.mock('@/lib/data/periodLeaderboard', () => ({
  getPeriodLeaderboard: vi.fn(async () => ({ rows: mockRows(100), supported: true })),
  getLeaderboardAroundMe: vi.fn(async () => ({ rows: [], supported: true })),
}));
vi.mock('@/hooks/useGlobalRank', () => ({ useGlobalRank: () => globalRankValue }));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@x.com' } }) }));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (k) => k,
    tFallback: (_k, fb, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), fb) : fb,
  }),
}));
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs' }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'mi' }) }));
vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));
vi.mock('@/lib/leaderboardStats', () => ({ backfillLeaderboardStatsOnce: vi.fn() }));
vi.mock('@/hooks/useDelayedLoading', () => ({ useDelayedLoading: (v) => v }));
vi.mock('@/api/db', () => ({ db: { entities: { User: { list: vi.fn(async () => []) } } } }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  motion: new Proxy({}, {
    get: () => ({ children, ...p }) => {
      const { initial, animate, exit, transition, whileTap, whileHover, layout, ...rest } = p;
      return React.createElement('div', rest, children);
    },
  }),
}));

const { default: LeaderboardsContent } = await import('../LeaderboardsContent');

function renderBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(LeaderboardsContent, { active: true }))
  );
}

beforeEach(() => {
  globalRankValue = { rank: null, value: null, ahead: null, gap: null, isLoading: false, supported: true };
});

describe('LeaderboardsContent — full board', () => {
  it('windows a 100-row board and offers an explicit way to see all of it', async () => {
    renderBoard();
    const showAll = await screen.findByText('Show all 100');
    expect(showAll).toBeInTheDocument();
    // Deep ranks are hidden until asked for.
    expect(screen.queryByText('Athlete 60')).toBeNull();
  });

  it('reveals every remaining rank when expanded', async () => {
    renderBoard();
    fireEvent.click(await screen.findByText('Show all 100'));
    // Rank 1-3 live in the podium; 4..100 in the list. Spot-check the far end.
    expect(await screen.findByText('Athlete 60')).toBeInTheDocument();
    expect(screen.getByText('Athlete 100')).toBeInTheDocument();
    expect(screen.queryByText('Show all 100')).toBeNull();
  });

  it('renders the podium for the top three, and keeps them out of the list', async () => {
    renderBoard();
    await screen.findByText('Show all 100');
    const podium = screen.getByRole('list', { name: 'Top 3' });
    expect(podium).toBeInTheDocument();
    // Each of the top three appears exactly once on screen.
    for (const n of [1, 2, 3]) {
      expect(screen.getAllByText(`Athlete ${n}`)).toHaveLength(1);
    }
  });
});

describe('LeaderboardsContent — caller below the top 100', () => {
  it('pins a row with their true global rank', async () => {
    globalRankValue = { ...globalRankValue, rank: 347, value: 4200 };
    renderBoard();
    expect(await screen.findByText('#347')).toBeInTheDocument();
    expect(screen.getByText('Outside the top 100')).toBeInTheDocument();
  });

  // An athlete with no activity is unranked, not "rank 4000". The RPC
  // returns the head of the board with is_me false in that case, which
  // useGlobalRank surfaces as a null rank — the row must stay hidden.
  it('shows nothing when the caller is unranked entirely', async () => {
    globalRankValue = { ...globalRankValue, rank: null, value: null };
    renderBoard();
    await screen.findByText('Show all 100');
    expect(screen.queryByText(/Outside the top/)).toBeNull();
  });

  it('does not pin the row when the caller is already on the board', async () => {
    globalRankValue = { ...globalRankValue, rank: 5, value: 9950 };
    const { getPeriodLeaderboard } = await import('@/lib/data/periodLeaderboard');
    getPeriodLeaderboard.mockResolvedValueOnce({
      rows: mockRows(100).map((r, i) => (i === 4 ? { ...r, user_id: 'me' } : r)),
      supported: true,
    });
    renderBoard();
    await screen.findByText('Show all 100');
    expect(screen.queryByText(/Outside the top/)).toBeNull();
  });
});
