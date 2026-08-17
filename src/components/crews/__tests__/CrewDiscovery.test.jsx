// Render tests for CrewDiscovery — the public crew directory.
//
// What matters here is that a row tells the truth about what you can do with
// it. The control SWAPS between four states rather than greying out, because a
// greyed button is a dead end and a swapped one is information.
//
// Two of these states were previously unreachable. The old surface read the
// crews table straight from the browser, and crew_members SELECT is
// is_crew_member(crew_id) — so a member count for a crew you are not in could
// never arrive. The row branched on a `_memberCount` nothing set, meaning every
// result in production rendered "up to 16" and "Full" was dead code. These
// tests exist so that cannot quietly come back.
//
// joinStateFor is deliberately NOT mocked: it is the logic under test.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' } }),
}));

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, fallback, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), fallback) : fallback,
    language: 'en' }),
}));

vi.mock('@/lib/intl', () => ({
  useNumberFormatter: () => (n, opts) =>
    opts?.notation === 'compact'
      ? new Intl.NumberFormat('en-US', opts).format(Number(n))
      : String(n),
}));

vi.mock('@/lib/toast', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const getMyCrews = vi.fn();
const joinCrew   = vi.fn();
vi.mock('@/lib/data/crews', () => ({
  getMyCrews: (...a) => getMyCrews(...a),
  joinCrew:   (...a) => joinCrew(...a),
}));

const listPublicCrews = vi.fn();
vi.mock('@/lib/data/crewDirectory', async (importActual) => {
  const actual = await importActual();
  return { ...actual, listPublicCrews: (...a) => listPublicCrews(...a) };
});

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { default: CrewDiscovery } = await import('../CrewDiscovery');

function renderDirectory() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrewDiscovery inline onBack={() => {}} onJoined={() => {}} />
    </QueryClientProvider>,
  );
}

const crew = (over = {}) => ({
  id: 'c1', name: 'Iron Union', tag: 'IRON', description: null, avatar_url: null,
  member_count: 12, max_capacity: 16, total_volume_lbs: 0,
  crew_level: 8, trophies: 0, wars_won: 0, wars_lost: 0, is_member: false, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getMyCrews.mockResolvedValue([]);
});

describe('CrewDiscovery row states', () => {
  it('offers Join on a crew with room', async () => {
    listPublicCrews.mockResolvedValue([crew()]);
    renderDirectory();
    expect(await screen.findByText('Join')).toBeTruthy();
  });

  it('says Full at capacity — the state the old surface could never reach', async () => {
    listPublicCrews.mockResolvedValue([crew({ member_count: 16 })]);
    renderDirectory();
    expect(await screen.findByText('Full')).toBeTruthy();
    expect(screen.queryByText('Join')).toBeNull();
  });

  it('marks the viewer own crew rather than inviting them to join it', async () => {
    getMyCrews.mockResolvedValue([{ id: 'c1', name: 'Iron Union' }]);
    listPublicCrews.mockResolvedValue([crew({ is_member: true })]);
    renderDirectory();
    expect(await screen.findByText('Your crew')).toBeTruthy();
  });

  it('offers no control at all to someone already in another crew', async () => {
    // Migration 252 is one crew per user. A row of greyed buttons would repeat
    // the explanation once per crew; the sentence above the list says it once.
    getMyCrews.mockResolvedValue([{ id: 'other', name: 'Rival' }]);
    listPublicCrews.mockResolvedValue([crew()]);
    renderDirectory();
    await screen.findByText('Iron Union');
    expect(screen.queryByText('Join')).toBeNull();
    expect(screen.getByText(/Leave it from the Crew page/)).toBeTruthy();
  });

  it('shows a real member count instead of "up to 16"', async () => {
    listPublicCrews.mockResolvedValue([crew({ member_count: 12 })]);
    const { container } = renderDirectory();
    await screen.findByText('Iron Union');
    expect(container.textContent).toContain('12');
    expect(container.textContent).toContain('of');
    expect(container.textContent).not.toContain('up to');
  });

  it('renders combined volume compactly once a crew has lifted something', async () => {
    listPublicCrews.mockResolvedValue([crew({ total_volume_lbs: 2_417_650 })]);
    renderDirectory();
    await screen.findByText('Iron Union');
    expect(screen.getByText('2.4M')).toBeTruthy();
  });

  it('says a crew has logged nothing rather than printing 0 lbs', async () => {
    listPublicCrews.mockResolvedValue([crew({ total_volume_lbs: 0 })]);
    renderDirectory();
    await screen.findByText('Iron Union');
    expect(screen.getByText(/no volume logged yet/)).toBeTruthy();
  });

  it('explains what a Crew is when the directory is empty', async () => {
    // Asserts the CATALOG's wording, not the call-site fallback. This test
    // mocks tFallback as `(_k, fallback) => fallback`, so it was passing
    // against "No public crews yet" — a string no user has ever seen, because
    // `getTranslation` returns en.json whenever the key exists and en.json has
    // said "No crews yet" since migration 370 made every crew visible. The
    // test agreed with the source and both disagreed with the screen.
    listPublicCrews.mockResolvedValue([]);
    renderDirectory();
    expect(await screen.findByText('No crews yet')).toBeTruthy();
    expect(screen.getByText(/go to war with other crews/)).toBeTruthy();
  });

  it('asks the server for the chosen sort', async () => {
    listPublicCrews.mockResolvedValue([]);
    renderDirectory();
    await waitFor(() => {
      expect(listPublicCrews).toHaveBeenCalledWith({ query: '', sort: 'volume', limit: 30 });
    });
  });
});
