// The crew deep link: `initialCrewId` must open that crew once the crews load.
//
// This regressed silently and stayed broken. The prop used to be consumed by
// `onSuccess` on the `useQuery` that fetches My Crews, and react-query REMOVED
// per-query callbacks in v5 — an unknown option is not an error, so nothing
// warned and nothing threw. Every deep link simply landed on the My Crews list:
// accepting a crew DM invite, the Crew Wars menu, and the crew-war pill on a
// profile all dispatch `flexyn:open-crew`, which makes Hub set `pendingCrewId`
// and switch to the Crews tab — and by then this component is mounting fresh,
// so its own `flexyn:open-crew` listener has nothing left to hear. The prop is
// the only carrier, which is why the dead callback took the whole path with it.
//
// The first test below is the regression: revert CrewsSection to `onSuccess`
// and it fails while everything else in the suite still passes.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'a@b.c' } }),
}));

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, fallback, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), fallback) : fallback,
    language: 'en',
  }),
}));

vi.mock('@/lib/intl', () => ({ useNumberFormatter: () => (n) => String(n) }));

const getMyCrews = vi.fn();
vi.mock('@/lib/data/crews', () => ({
  getMyCrews: (...a) => getMyCrews(...a),
}));

vi.mock('@/lib/data/crewSeasons', () => ({
  crewLevelProgress: () => ({ into: 500, span: 1000, pct: 0.5 }),
}));

// The destination. Rendering its name is enough to prove we navigated.
vi.mock('../CrewPage', () => ({
  default: ({ crew }) => <div data-testid="crew-page">{crew.name}</div>,
}));
vi.mock('../CrewCreationFlow', () => ({ default: () => <div /> }));
vi.mock('../CrewMemberDots', () => ({ default: () => <div /> }));
vi.mock('../CrewSuggestionRail', () => ({ default: () => <div /> }));
vi.mock('../CrewDiscovery', () => ({ default: () => <div data-testid="discover" /> }));
vi.mock('@/components/ChatViewportFrame', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

import CrewsSection from '../CrewsSection';

const CREWS = [
  { id: 'c-1', name: 'Iron Legion', member_count: 4, total_xp: 100 },
  { id: 'c-2', name: 'Dawn Patrol',  member_count: 7, total_xp: 200 },
];

function renderSection(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrewsSection onViewProfile={() => {}} {...props} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getMyCrews.mockResolvedValue(CREWS);
});

describe('CrewsSection deep link', () => {
  it('opens the crew named by initialCrewId once the crews resolve', async () => {
    renderSection({ initialCrewId: 'c-2' });
    await waitFor(() => expect(screen.getByTestId('crew-page')).toBeTruthy());
    expect(screen.getByTestId('crew-page').textContent).toBe('Dawn Patrol');
  });

  it('stays on the list when no crew was asked for', async () => {
    renderSection();
    await waitFor(() => expect(getMyCrews).toHaveBeenCalled());
    expect(screen.queryByTestId('crew-page')).toBeNull();
  });

  it('stays on the list when the id is not one of yours', async () => {
    // A stale link, or a crew you have since left. The list is the honest
    // destination — opening someone else's crew page would be worse.
    renderSection({ initialCrewId: 'c-does-not-exist' });
    await waitFor(() => expect(getMyCrews).toHaveBeenCalled());
    expect(screen.queryByTestId('crew-page')).toBeNull();
  });

  it('still opens the crew when flexyn:open-crew fires while already mounted', async () => {
    // The other half of the contract: the listener handles the event when this
    // component is ALREADY on screen, where the prop never changes.
    //
    // Wait for the LIST to render, not merely for the fetch to be issued. The
    // listener closes over `myCrews`, so dispatching while that is still `[]`
    // finds nothing — which is a property of the real component too, not just
    // the test: an event arriving before the crews load is dropped.
    renderSection();
    await waitFor(() => expect(screen.getByText('Iron Legion')).toBeTruthy());
    window.dispatchEvent(new CustomEvent('flexyn:open-crew', { detail: { crewId: 'c-1' } }));
    await waitFor(() => expect(screen.getByTestId('crew-page')).toBeTruthy());
    expect(screen.getByTestId('crew-page').textContent).toBe('Iron Legion');
  });
});
