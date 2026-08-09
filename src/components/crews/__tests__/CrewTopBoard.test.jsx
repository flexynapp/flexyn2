// Render tests for CrewTopBoard — the global crew ladder.
//
// Three properties are worth locking in, and none of them is cosmetic.
//
//   * RANK COMES FROM THE SERVER. The rows are the top N plus a window around
//     your own crew, so their ranks are deliberately non-contiguous. Anything
//     that renumbers them from the array index would silently tell a crew in
//     41st place that it is 4th.
//   * THE GAP IS DRAWN. That non-contiguity is the ellipsis, and without it
//     the board reads as a five-crew league.
//   * A ZERO IS NOT A SCORE. Production currently has one user with any volume
//     at all, so every crew scores zero on every metric. The board has to say
//     that rather than render a proud column of 0s.
//
// The pane could not be used to eyeball this: Hub wraps its sub-tabs in an
// AnimatePresence mode="wait", and with the browser pane hidden rAF is
// throttled, so the exit animation never completes and the entering tab never
// mounts. That is an artefact of the harness, not the app — but it means these
// assertions, not a screenshot, are what proves the surface renders.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ tFallback: (_k, fallback) => fallback, language: 'en' }),
}));

vi.mock('@/lib/intl', () => ({
  useNumberFormatter: () => (n, opts) =>
    opts?.notation === 'compact'
      ? new Intl.NumberFormat('en-US', opts).format(Number(n))
      : String(n),
}));

const getTopCrews = vi.fn();
vi.mock('@/lib/data/crewDirectory', () => ({
  getTopCrews: (...a) => getTopCrews(...a),
}));

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { default: CrewTopBoard } = await import('../CrewTopBoard');

function renderBoard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrewTopBoard />
    </QueryClientProvider>,
  );
}

const row = (over = {}) => ({
  rank: 1, id: 'c1', name: 'Iron Union', tag: 'IRON', avatar_url: null,
  member_count: 12, max_capacity: 16, crew_level: 8, trophies: 0,
  value: 0, is_member: false, ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('CrewTopBoard', () => {
  it('renders the server rank, not the array index', async () => {
    getTopCrews.mockResolvedValue({
      metric: 'volume',
      myRank: 41,
      total: 120,
      rows: [
        row({ rank: 1,  id: 'a', name: 'Alpha', value: 900 }),
        row({ rank: 2,  id: 'b', name: 'Bravo', value: 800 }),
        row({ rank: 40, id: 'd', name: 'Delta', value: 12 }),
        row({ rank: 41, id: 'e', name: 'Echo',  value: 11, is_member: true }),
      ],
    });

    renderBoard();

    await screen.findByText('Alpha');
    expect(screen.getByText('40')).toBeTruthy();
    expect(screen.getByText('41')).toBeTruthy();
    // The third row is index 2 — if rank were derived from position it would
    // read "3" and there would be no 40 or 41 anywhere.
    expect(screen.queryByText('3')).toBeNull();
  });

  it('draws one ellipsis where the ranks jump, and none where they do not', async () => {
    getTopCrews.mockResolvedValue({
      metric: 'volume', myRank: 41, total: 120,
      rows: [
        row({ rank: 1,  id: 'a', name: 'Alpha', value: 900 }),
        row({ rank: 2,  id: 'b', name: 'Bravo', value: 800 }),
        row({ rank: 40, id: 'd', name: 'Delta', value: 12 }),
        row({ rank: 41, id: 'e', name: 'Echo',  value: 11 }),
      ],
    });

    const { container } = renderBoard();
    await screen.findByText('Alpha');

    // 1→2 and 40→41 are contiguous; 2→40 is not.
    const gaps = [...container.querySelectorAll('p')].filter(p => p.textContent === '···');
    expect(gaps).toHaveLength(1);
  });

  it('says nobody has scored rather than rendering a column of zeros', async () => {
    getTopCrews.mockResolvedValue({
      metric: 'volume', myRank: null, total: 4,
      rows: [row({ rank: 1, id: 'a', name: 'Alpha' }), row({ rank: 2, id: 'b', name: 'Bravo' })],
    });

    renderBoard();

    await screen.findByText('Alpha');
    expect(screen.getByText(/No crew has logged any volume yet/)).toBeTruthy();
    // Values render as an em-dash, never "0".
    expect(screen.getAllByText('—').length).toBe(2);
  });

  it('drops the zero notice as soon as one crew has a real value', async () => {
    getTopCrews.mockResolvedValue({
      metric: 'volume', myRank: null, total: 2,
      rows: [row({ rank: 1, id: 'a', name: 'Alpha', value: 2_400_000 }), row({ rank: 2, id: 'b', name: 'Bravo' })],
    });

    renderBoard();

    await screen.findByText('Alpha');
    expect(screen.queryByText(/No crew has logged any volume yet/)).toBeNull();
    expect(screen.getByText('2.4M')).toBeTruthy();
  });

  it('offers a way in instead of a rank when the viewer has no crew', async () => {
    getTopCrews.mockResolvedValue({
      metric: 'volume', myRank: null, total: 4, rows: [row({ name: 'Alpha' })],
    });

    renderBoard();

    await screen.findByText('Alpha');
    expect(screen.getByText(/Join a public crew to take a place/)).toBeTruthy();
  });

  it('reports the viewer crew standing when it has one', async () => {
    getTopCrews.mockResolvedValue({
      metric: 'volume', myRank: 41, total: 120,
      rows: [row({ name: 'Alpha', is_member: true, rank: 41 })],
    });

    renderBoard();

    await screen.findByText('Alpha');
    expect(screen.getByText('#41')).toBeTruthy();
    expect(screen.getByText('120')).toBeTruthy();
  });

  it('explains what an empty board means instead of showing nothing', async () => {
    getTopCrews.mockResolvedValue({ metric: 'volume', myRank: null, total: 0, rows: [] });

    renderBoard();

    expect(await screen.findByText('No crews on the board yet')).toBeTruthy();
    expect(screen.getByText(/Make yours public from the Crew page/)).toBeTruthy();
  });

  it('refetches against the chosen metric when the switch is used', async () => {
    getTopCrews.mockResolvedValue({ metric: 'volume', myRank: null, total: 0, rows: [] });
    renderBoard();
    await screen.findByText('No crews on the board yet');

    fireEvent.click(screen.getByText('Trophies'));

    await waitFor(() => {
      expect(getTopCrews).toHaveBeenCalledWith({ metric: 'trophies', limit: 25 });
    });
  });
});
