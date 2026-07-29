import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const mockGetAroundMe = vi.fn();

vi.mock('@/lib/data/periodLeaderboard', () => ({
  getLeaderboardAroundMe: (...args) => mockGetAroundMe(...args),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me' } }),
}));

const { useGlobalRank } = await import('../useGlobalRank');

function wrapper({ children }) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return React.createElement(QueryClientProvider, { client: qc }, children);
}

const render = () => renderHook(() => useGlobalRank(), { wrapper });

beforeEach(() => mockGetAroundMe.mockReset());

describe('useGlobalRank', () => {
  it('pulls rank, value and the gap to the athlete directly ahead', async () => {
    mockGetAroundMe.mockResolvedValue({
      supported: true,
      rows: [
        { rank: 3, user_id: 'a', username: 'gabe', value: '65', is_me: false },
        { rank: 4, user_id: 'me', username: 'kegan', value: '52', is_me: true },
        { rank: 5, user_id: 'b', username: 'kb', value: '51', is_me: false },
      ],
    });
    const { result } = render();
    await waitFor(() => expect(result.current.rank).toBe(4));
    expect(result.current.value).toBe(52);
    expect(result.current.ahead.username).toBe('gabe');
    expect(result.current.gap).toBe(13);
  });

  it('reports no gap when the caller leads the board', async () => {
    mockGetAroundMe.mockResolvedValue({
      supported: true,
      rows: [
        { rank: 1, user_id: 'me', value: '559', is_me: true },
        { rank: 2, user_id: 'b', value: '100', is_me: false },
      ],
    });
    const { result } = render();
    await waitFor(() => expect(result.current.rank).toBe(1));
    expect(result.current.ahead).toBeNull();
    expect(result.current.gap).toBeNull();
  });

  // When the caller isn't ranked, the RPC returns the head of the board with
  // is_me false on every row. Matching on user id instead of the is_me flag
  // would mis-read one of those strangers as the caller.
  it('returns a null rank when the caller is not on the board', async () => {
    mockGetAroundMe.mockResolvedValue({
      supported: true,
      rows: [
        { rank: 1, user_id: 'a', value: '559', is_me: false },
        { rank: 2, user_id: 'b', value: '100', is_me: false },
      ],
    });
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.rank).toBeNull();
    expect(result.current.value).toBeNull();
    expect(result.current.gap).toBeNull();
  });

  it('surfaces an unsupported host so callers can hide the surface', async () => {
    mockGetAroundMe.mockResolvedValue({ supported: false, rows: [] });
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.supported).toBe(false);
    expect(result.current.gap).toBeNull();
  });

  it('never reports a negative gap if the ordering is momentarily stale', async () => {
    mockGetAroundMe.mockResolvedValue({
      supported: true,
      rows: [
        { rank: 3, user_id: 'a', username: 'gabe', value: '40', is_me: false },
        { rank: 4, user_id: 'me', value: '52', is_me: true },
      ],
    });
    const { result } = render();
    await waitFor(() => expect(result.current.rank).toBe(4));
    expect(result.current.gap).toBe(0);
  });
});
