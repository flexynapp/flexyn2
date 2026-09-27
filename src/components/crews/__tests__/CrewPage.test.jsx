// Render tests for CrewPage.
//
// This is the navigation change from docs/crew-page-research.md: tapping a
// Crew used to return <CrewChat /> directly, so a Crew *was* a message
// thread. The properties worth locking in are structural rather than
// cosmetic:
//
//   * the crew opens as a subject — its name, leader and state are on
//     screen without touching anything
//   * chat is a tab, and is NOT mounted until you pick it (it opens a
//     realtime subscription and a message query; mounting it eagerly would
//     make every crew visit pay for a thread nobody opened)
//   * the roster renders inline without a profilesByUserId map, since
//     getCrewMembers already enriches rows
//
// The heavy children are stubbed. This asserts the page's own composition
// and tab behaviour, not their internals — those have their own tests.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Stubs ────────────────────────────────────────────────────────────
vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u-leader', email: 'a@b.c' } }),
}));

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, fallback, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), fallback) : fallback,
    language: 'en' }),
}));

vi.mock('@/lib/intl', () => ({
  useNumberFormatter: () => (n) => String(n),
}));

const getCrewMembers = vi.fn();
vi.mock('@/lib/data/crews', () => ({
  getCrewMembers: (...a) => getCrewMembers(...a),
}));

const getDivisionStandings = vi.fn();
vi.mock('@/lib/data/crewSeasons', () => ({
  getDivisionStandings: (...a) => getDivisionStandings(...a),
  placingFor: () => 4,
  crewLevelProgress: () => ({ into: 500, span: 1000, pct: 0.5 }),
}));

const getTreasury = vi.fn();
vi.mock('@/lib/data/crewTreasury', () => ({
  getTreasury: (...a) => getTreasury(...a),
}));

vi.mock('@/components/ChatViewportFrame', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

const chatMounts = vi.fn();
vi.mock('../CrewChat', () => ({
  default: () => { chatMounts(); return <div data-testid="chat">chat</div>; },
}));
vi.mock('../CrewBattleEntry', () => ({
  default: () => <div data-testid="war">war</div>,
}));
vi.mock('../CrewChallengeCard', () => ({
  default: () => <div data-testid="challenges">challenges</div>,
}));
vi.mock('../CrewLeaguePanel', () => ({
  default: () => <div data-testid="league">league</div>,
}));

const directoryProps = vi.fn();
vi.mock('../CrewMemberDirectory', () => ({
  default: (props) => { directoryProps(props); return <div data-testid="roster">roster</div>; },
}));

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { default: CrewPage } = await import('../CrewPage');

const CREW = {
  id: 'c1',
  name: 'Iron Union',
  crew_level: 12,
  trophies: 240,
  wars_won: 24,
  wars_lost: 9,
  max_capacity: 16,
  is_admin: true,
};

function renderPage(crew = CREW) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <CrewPage crew={crew} onBack={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCrewMembers.mockResolvedValue([
    { id: 'm1', user_id: 'u-leader', is_admin: true,  role: 'leader', username: 'marcus_lifts' },
    { id: 'm2', user_id: 'u-2',      is_admin: false, role: 'member',  username: 'dana' },
  ]);
  getDivisionStandings.mockResolvedValue({
    seasonNumber: 1, endsAt: null, division: 3, rows: [{ crew_id: 'c1' }],
  });
  getTreasury.mockResolvedValue({
    balance: 2450, maxCapacity: 17, perks: [], ledger: [],
  });
});

describe('CrewPage — opens the crew as a subject', () => {
  it('names the crew without any interaction', async () => {
    renderPage();
    expect(await screen.findByText('Iron Union')).toBeTruthy();
  });

  it('shows the crew level and record in the header', async () => {
    renderPage();
    expect(await screen.findByText(/Lv\. 12/)).toBeTruthy();
    expect(screen.getByText('24')).toBeTruthy();
  });

  it('names the leader once members load', async () => {
    renderPage();
    // Habitica puts the leader directly under the group name; this is the
    // same idea, and it needs the enriched member row to carry `username`.
    expect(await screen.findByText(/Led by marcus_lifts/)).toBeTruthy();
  });

  it('surfaces the war on the landing tab, not behind another tab', async () => {
    renderPage();
    expect(await screen.findByTestId('war')).toBeTruthy();
    expect(screen.getByTestId('challenges')).toBeTruthy();
  });

  it('renders a header even before the async queries resolve', () => {
    // No await: the crew object itself carries name/level, so the page must
    // not depend on a round trip to say what crew you are looking at.
    renderPage();
    expect(screen.getByText('Iron Union')).toBeTruthy();
  });
});

describe('CrewPage — tabs', () => {
  it('does NOT mount chat until the tab is selected', async () => {
    renderPage();
    await screen.findByTestId('war');
    // Chat opens a realtime subscription and a message query. Mounting it
    // eagerly would make every crew visit pay for a thread nobody opened.
    expect(chatMounts).not.toHaveBeenCalled();
    expect(screen.queryByTestId('chat')).toBeNull();
  });

  it('mounts chat when the Chat tab is picked', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Chat'));
    expect(await screen.findByTestId('chat')).toBeTruthy();
    expect(chatMounts).toHaveBeenCalled();
  });

  it('swaps to the roster and the league', async () => {
    renderPage();

    fireEvent.click(screen.getByText('Roster'));
    expect(await screen.findByTestId('roster')).toBeTruthy();
    expect(screen.queryByTestId('war')).toBeNull();

    fireEvent.click(screen.getByText('League'));
    expect(await screen.findByTestId('league')).toBeTruthy();
  });

  it('keeps the header visible across every tab', async () => {
    renderPage();
    for (const label of ['Roster', 'Chat', 'League', 'Home']) {
      fireEvent.click(screen.getByText(label));
      expect(screen.getByText('Iron Union')).toBeTruthy();
    }
  });
});

describe('CrewPage — roster wiring', () => {
  it('renders the roster inline and without a profile map', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Roster'));
    await screen.findByTestId('roster');

    const props = directoryProps.mock.calls.at(-1)[0];
    expect(props.inline).toBe(true);
    // getCrewMembers already enriches rows with username/avatar_url, so the
    // page passes no map; the directory falls back to the member itself.
    expect(props.profilesByUserId).toBeUndefined();
    expect(props.crewId).toBe('c1');
  });

  it('passes the perk-raised capacity, not the hardcoded 16', async () => {
    renderPage();
    fireEvent.click(screen.getByText('Roster'));
    await screen.findByTestId('roster');
    // treasury.maxCapacity is 17 here — an extra_seat perk was bought.
    expect(directoryProps.mock.calls.at(-1)[0].maxCapacity).toBe(17);
  });
});

describe('CrewPage — degrades on a pre-248 crew', () => {
  it('renders without level, standings or treasury', async () => {
    getDivisionStandings.mockResolvedValue(null);
    getTreasury.mockResolvedValue(null);

    renderPage({ id: 'c1', name: 'Bare Crew', is_admin: false });

    expect(await screen.findByText('Bare Crew')).toBeTruthy();
    expect(screen.queryByText(/Lv\. /)).toBeNull();
    expect(screen.queryByText(/in Division/)).toBeNull();
  });

  it('returns null for a missing crew rather than throwing', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { container } = render(
      <QueryClientProvider client={qc}>
        <CrewPage crew={null} onBack={() => {}} />
      </QueryClientProvider>,
    );
    expect(container.textContent).toBe('');
  });
});

describe('the crew settings entry', () => {
  // The gate must be is_admin and NOT the 'leader' string, because
  // `is_crew_admin` — which the crews_update policy uses for both USING and
  // WITH CHECK — reads `crew_members.is_admin`. The two agree on every row in
  // production today (5 leader/true, 1 member/false), so a test on the role
  // string would pass while the control was shown to someone the server would
  // refuse, and a refused UPDATE returns 0 rows rather than an error — a
  // silent dead button. Verified against production by execution.
  it('is offered to a member whose is_admin is true', async () => {
    renderPage();
    expect(await screen.findByLabelText('Crew settings')).toBeTruthy();
  });

  it('is withheld from a plain member', async () => {
    getCrewMembers.mockResolvedValue([
      { id: 'm1', user_id: 'u-someone-else', is_admin: true,  role: 'leader', username: 'marcus_lifts' },
      { id: 'm2', user_id: 'u-leader',       is_admin: false, role: 'member', username: 'dana' },
    ]);
    renderPage({ ...CREW, is_admin: false });

    expect(await screen.findByText('Iron Union')).toBeTruthy();
    expect(screen.queryByLabelText('Crew settings')).toBeNull();
  });
});

describe('the crew description and tag', () => {
  // Nothing could write either column until the settings sheet shipped, so
  // every crew in production takes the null branch. A reserved blank line for
  // a description nobody has written is the "a section with no data must not
  // render as zeros" rule in CLAUDE.md.
  it('renders the description when the crew has one', async () => {
    renderPage({ ...CREW, description: 'Early risers, heavy compounds.' });
    expect(await screen.findByText('Early risers, heavy compounds.')).toBeTruthy();
  });

  it('renders the tag beside the name when set', async () => {
    renderPage({ ...CREW, tag: 'IRON' });
    expect(await screen.findByText('IRON')).toBeTruthy();
  });

  it('draws no empty paragraph when there is no description', async () => {
    const { container } = renderPage({ ...CREW, description: null });
    await screen.findByText('Iron Union');
    const empties = [...container.querySelectorAll('p')].filter(p => !p.textContent.trim());
    expect(empties).toHaveLength(0);
  });
});
