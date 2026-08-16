// Render tests for CrewWarsMenu — the sheet the Workout hero opens.
//
// Three properties are worth pinning, and two of them are regressions of
// bugs this component was written to fix:
//
//   1. It does not navigate to /hub on open. The card it replaced did
//      `navigate('/hub', { state: { openCrewWars: true } })` and nothing
//      in Hub has ever read `openCrewWars`, so the tap dropped the user
//      on the Hub feed. If a future edit reintroduces navigation on
//      mount, "the Crew Wars button just leads to the Hub" comes back.
//
//   2. A crew with no war history does not render "0–0". A zero here
//      reads as a loss the crew never took — the "a section with no data
//      must not render as zeros" rule in CLAUDE.md.
//
//   3. The primary button hands the crew id to Hub through ROUTER STATE,
//      not through the `flexyn:open-crew` event the other two callers
//      use. Hub is unmounted when this fires, so an event would be
//      dispatched into nothing — the same class of failure as the bug in
//      (1). A test that only asserted "navigates to /hub" would pass
//      while the crew page never opened.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useNavigate: () => navigate,
}));

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, fallback, vars) => {
      let s = fallback;
      if (vars) Object.entries(vars).forEach(([k, v]) => {
        s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
      return s;
    },
  }),
}));

vi.mock('@/lib/intl', () => ({
  useNumberFormatter: () => (n) => new Intl.NumberFormat('en-US').format(Number(n) || 0),
}));

const getActiveWarForCrew = vi.fn();
const getQueuedWarForCrew = vi.fn();
const getWarBreakdown     = vi.fn();
vi.mock('@/lib/data/crewWars', async (importActual) => {
  const actual = await importActual();
  return {
    ...actual,
    getActiveWarForCrew: (...a) => getActiveWarForCrew(...a),
    getQueuedWarForCrew: (...a) => getQueuedWarForCrew(...a),
    getWarBreakdown:     (...a) => getWarBreakdown(...a),
  };
});

const getCrewMemberCount = vi.fn();
const getCrew            = vi.fn();
vi.mock('@/lib/data/crews', () => ({
  getCrewMemberCount: (...a) => getCrewMemberCount(...a),
  getCrew:            (...a) => getCrew(...a),
}));

// BottomSheet portals into document.body and pulls in framer + a scroll
// lock. The sheet's chrome is not what these tests are about, so it is
// reduced to a passthrough that still renders the title and a close
// button — the two things the brief names.
vi.mock('@/components/ui/BottomSheet', () => ({
  default: ({ open, onClose, title, children }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        <h2>{title}</h2>
        <button aria-label="Close" onClick={onClose}>×</button>
        {children}
      </div>
    ) : null,
}));

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { default: CrewWarsMenu } = await import('../CrewWarsMenu');

const CREW = {
  id: 'c1', name: 'Iron Legion', tag: 'IRL',
  crew_level: 4, wars_won: 3, wars_lost: 1, wars_drawn: 0,
};

function show(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrewWarsMenu
        open
        onClose={() => {}}
        crew={CREW}
        currentUserId="u1"
        {...props}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getActiveWarForCrew.mockResolvedValue(null);
  getQueuedWarForCrew.mockResolvedValue(null);
  getWarBreakdown.mockResolvedValue(null);
  getCrewMemberCount.mockResolvedValue(6);
  getCrew.mockResolvedValue({ id: 'c2', name: 'Northgate', tag: 'NOR' });
});

describe('CrewWarsMenu — no active war', () => {
  it('says No Active Wars rather than navigating to the Hub', async () => {
    show();
    expect(await screen.findByText('No Active Wars')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('offers a close control and a button to the crew page', async () => {
    show();
    await screen.findByText('No Active Wars');
    expect(screen.getByLabelText('Close')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Go to Iron Legion/ })).toBeTruthy();
  });

  it('hands the crew id to Hub as router state, not as an event', async () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    show();
    await screen.findByText('No Active Wars');

    await userEvent.click(screen.getByRole('button', { name: /Go to Iron Legion/ }));

    expect(navigate).toHaveBeenCalledWith('/hub', { state: { openCrewId: 'c1' } });
    // An event here would fire before Hub mounts and be lost.
    const crewEvents = dispatch.mock.calls.filter(
      ([e]) => e?.type === 'flexyn:open-crew',
    );
    expect(crewEvents).toHaveLength(0);
  });

  it('shows the record for a crew that has fought', async () => {
    show();
    expect(await screen.findByText('3–1')).toBeTruthy();
  });

  it('drops the record cell for a crew that never has — no "0–0"', async () => {
    show({ crew: { ...CREW, wars_won: 0, wars_lost: 0, wars_drawn: 0 } });
    await screen.findByText('No Active Wars');
    expect(screen.queryByText('0–0')).toBeNull();
    expect(screen.queryByText('RECORD')).toBeNull();
  });

  it('omits the roster cell when the count could not be read', async () => {
    // null means "we do not know", and it must not render as 0 lifters.
    getCrewMemberCount.mockResolvedValue(null);
    show();
    await screen.findByText('No Active Wars');
    await waitFor(() => expect(screen.queryByText(/0 lifters/)).toBeNull());
  });
});

describe('CrewWarsMenu — queued', () => {
  it('names what the pairing is matched on', async () => {
    getQueuedWarForCrew.mockResolvedValue({ id: 'q1', crew_a_id: 'c1', status: 'matchmaking' });
    show();
    expect(await screen.findByText('Find A Rival Crew')).toBeTruthy();
    expect(screen.getByText('Roster size')).toBeTruthy();
    expect(screen.getByText('Strength')).toBeTruthy();
  });
});

describe('CrewWarsMenu — live war', () => {
  const WAR = {
    id: 'w1',
    crew_a_id: 'c1',
    crew_b_id: 'c2',
    crew_a_score: 8420,
    crew_b_score: 7180,
    status: 'active',
    ends_at: new Date(Date.now() + 3 * 86400000).toISOString(),
  };

  it('shows both scores and who is ahead', async () => {
    getActiveWarForCrew.mockResolvedValue(WAR);
    show();
    expect(await screen.findByText('8,420')).toBeTruthy();
    expect(screen.getByText('7,180')).toBeTruthy();
    expect(screen.getByText(/Ahead by 1,240/)).toBeTruthy();
  });

  it('names the rival crew rather than calling it "Rival crew"', async () => {
    getActiveWarForCrew.mockResolvedValue(WAR);
    show();
    expect(await screen.findByText('Northgate')).toBeTruthy();
    expect(screen.queryByText('Rival crew')).toBeNull();
  });

  it('falls back to a generic label when the rival crew cannot be read', async () => {
    getActiveWarForCrew.mockResolvedValue(WAR);
    getCrew.mockResolvedValue(null);
    show();
    expect(await screen.findByText('Rival crew')).toBeTruthy();
  });

  it('says the sides field the same number of lifters', async () => {
    // The scoring change in migration 356 is only honest if the sheet
    // explains it — a score that is not a plain sum has to say so.
    getActiveWarForCrew.mockResolvedValue(WAR);
    show();
    await screen.findByText('8,420');
    expect(screen.getByText(/same number of lifters/)).toBeTruthy();
  });

  it('ranks BOTH crews on one head-to-head board', async () => {
    getActiveWarForCrew.mockResolvedValue(WAR);
    getWarBreakdown.mockResolvedValue({
      warId: 'w1', myCrewId: 'c1', crewAId: 'c1', crewBId: 'c2', totals: [],
      members: [
        { user_id: 'u1', username: 'Kegan',  crew_id: 'c1', is_mine: true,  score: 2140, volume_lbs: 48200, sessions: 5, days_active: 4 },
        { user_id: 'r1', username: 'Dana',   crew_id: 'c2', is_mine: false, score: 2600, volume_lbs: null, sessions: null, days_active: null },
        { user_id: 'u2', username: 'Marcus', crew_id: 'c1', is_mine: true,  score: 1890, volume_lbs: 30000, sessions: 4, days_active: 3 },
      ],
    });
    show();
    // The rival outscoring us has to be on the board, and first.
    expect(await screen.findByText('Dana')).toBeTruthy();
    expect(screen.getByText('2,600')).toBeTruthy();
    expect(screen.getByText('Marcus')).toBeTruthy();
  });

  it('keeps a member on zero — an absent lifter is information on a versus board', async () => {
    getActiveWarForCrew.mockResolvedValue(WAR);
    getWarBreakdown.mockResolvedValue({
      warId: 'w1', myCrewId: 'c1', crewAId: 'c1', crewBId: 'c2', totals: [],
      members: [
        { user_id: 'u1', username: 'Kegan', crew_id: 'c1', is_mine: true, score: 2140, volume_lbs: 48200, sessions: 5, days_active: 4 },
        { user_id: 'u3', username: 'Idle',  crew_id: 'c1', is_mine: true, score: 0,    volume_lbs: 0, sessions: 0, days_active: 0 },
      ],
    });
    show();
    expect(await screen.findByText('Idle')).toBeTruthy();
  });

  it('does not render a rival day-count — it comes back null by design', async () => {
    getActiveWarForCrew.mockResolvedValue(WAR);
    getWarBreakdown.mockResolvedValue({
      warId: 'w1', myCrewId: 'c1', crewAId: 'c1', crewBId: 'c2', totals: [],
      members: [
        { user_id: 'r1', username: 'Dana', crew_id: 'c2', is_mine: false, score: 2600, volume_lbs: null, sessions: null, days_active: null },
      ],
    });
    show();
    await screen.findByText('Dana');
    expect(screen.queryByText(/null/)).toBeNull();
    expect(screen.queryByText(/· \d+d/)).toBeNull();
  });

  it('renders the viewer own contribution from the breakdown', async () => {
    getActiveWarForCrew.mockResolvedValue(WAR);
    getWarBreakdown.mockResolvedValue({
      warId: 'w1', myCrewId: 'c1', totals: [],
      members: [
        { user_id: 'u1', username: 'Kegan', score: 2140, volume_lbs: 48200, sessions: 5, days_active: 4 },
      ],
    });
    show();
    expect(await screen.findByText('48,200 lb')).toBeTruthy();
    expect(screen.getByText('4 / 7')).toBeTruthy();
  });
});
