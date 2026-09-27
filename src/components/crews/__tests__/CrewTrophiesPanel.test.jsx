// Render tests for the Trophies tab (migration 367, Penpot page
// "Crew Trophies").
//
// Four properties, each of them a decision that a plausible-looking edit
// would quietly undo:
//
//   1. A MEMBER NEVER SEES A START CONTROL. Not a disabled one either —
//      the server refuses with 42501 and a greyed button is a puzzle the
//      user has to decode. The leader gate is stated in copy instead.
//      `crewPermissions.js` mirrors migration 367 for the UI and is
//      explicitly NOT the enforcement, so this test is the only thing on
//      the client side holding that line.
//
//   2. LOCKED ROWS STILL RENDER. `get_crew_challenge_catalog` returns
//      them on purpose: a level-gated ladder whose next rung is invisible
//      gives a crew no reason to level up. Filtering them out is the
//      obvious "cleanup" and it removes the point of the feature.
//
//   3. THE EMPTY SHELF RENDERS THE LADDER, NOT A ZERO. Same rule as the
//      Crew Wars sheet not rendering "0–0" for a crew that has never
//      fought. An empty state with nothing to look at is a dead screen.
//
//   4. THE CHASE SHRINKS ONCE THE SHELF HAS WEIGHT. Boards B and C of the
//      design are one component at two sizes; the per-member contribution
//      list belongs to the big one only. A crew with trophies is a crew
//      whose subject is the collection.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
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
  useDateFormatter:   () => (d) => new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' }).format(d),
}));

vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const getCrewChallengeCatalog   = vi.fn();
const startGenerationalChallenge = vi.fn();
const getChallengeContributions  = vi.fn();
vi.mock('@/lib/data/crewChallenges', () => ({
  getCrewChallengeCatalog:    (...a) => getCrewChallengeCatalog(...a),
  startGenerationalChallenge: (...a) => startGenerationalChallenge(...a),
  getChallengeContributions:  (...a) => getChallengeContributions(...a),
}));

const getCrewTrophies = vi.fn();
vi.mock('@/lib/data/crewTrophies', () => ({
  getCrewTrophies: (...a) => getCrewTrophies(...a),
}));

vi.mock('@/components/ui/BottomSheet', () => ({
  default: ({ open, title, children }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { default: CrewTrophiesPanel, monogram } = await import('../CrewTrophiesPanel');
const { RANK } = await import('@/lib/crewPermissions');

const row = (o) => ({
  template_key: 'k', title: 'T', metric: 'total_volume', target_value: 100,
  min_crew_level: 1, trophy_id: 'tr', trophy_title: 'Trophy Name',
  state: 'available', current_value: 0, challenge_id: null, ...o,
});

const CATALOG = [
  row({ template_key: 'first_million', title: 'The First Million', trophy_title: 'Millionaires', target_value: 1000000 }),
  row({ template_key: 'century',       title: 'The Century', trophy_title: 'Centurions', metric: 'total_sessions', target_value: 100 }),
  row({ template_key: 'foundry',       title: 'The Foundry', trophy_title: 'Foundry', state: 'locked', min_crew_level: 3 }),
];

function mount(myRank) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrewTrophiesPanel crewId="c1" myRank={myRank} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  getCrewChallengeCatalog.mockResolvedValue(CATALOG);
  getCrewTrophies.mockResolvedValue([]);
  getChallengeContributions.mockResolvedValue([]);
});

describe('the leader gate', () => {
  it('gives a leader one primary control and no per-row buttons until the sheet opens', async () => {
    mount(RANK.LEADER);
    await screen.findByText('Choose a challenge');
    // The picker is closed, so no Start button is on the page yet.
    expect(screen.queryByText('Start')).toBeNull();
  });

  it('shows a member no start control at all, not even a disabled one', async () => {
    mount(RANK.MEMBER);
    await screen.findByText('Nothing being chased');
    expect(screen.queryByText('Choose a challenge')).toBeNull();
    expect(screen.queryByText('Start')).toBeNull();
    // and says why, rather than leaving them hunting for a button
    expect(screen.getByText('Your leader picks what the crew goes after next.')).toBeTruthy();
  });

  it('gives a moderator no start control either — 367 is leader-only, not moderator-up', async () => {
    mount(RANK.MODERATOR);
    await screen.findByText('Nothing being chased');
    expect(screen.queryByText('Choose a challenge')).toBeNull();
  });

  it('starts the challenge the leader picked, by template key', async () => {
    startGenerationalChallenge.mockResolvedValue({ ok: true, id: 'ch1' });
    mount(RANK.LEADER);
    await userEvent.click(await screen.findByText('Choose a challenge'));
    const starts = await screen.findAllByText('Start');
    // Only the two available rows are actionable; the locked one is not.
    expect(starts).toHaveLength(2);
    await userEvent.click(starts[0]);
    await waitFor(() => expect(startGenerationalChallenge).toHaveBeenCalledWith('c1', 'first_million'));
  });
});

// A read-only mid-chase picker was built and then removed (kegan,
// 2026-08-16): the tab already lists every remaining challenge inline
// under STILL OUT THERE, so a second route to the same rows was a tap
// that bought nothing. These pin the absence, because "let the leader
// peek at what's next" is exactly the kind of thing that gets re-added.
describe('while a chase is running', () => {
  const active = row({
    template_key: 'first_million', title: 'The First Million', trophy_title: 'Millionaires',
    state: 'active', current_value: 340120, target_value: 1000000, challenge_id: 'ch1',
  });

  beforeEach(() => {
    getCrewChallengeCatalog.mockResolvedValue([active, ...CATALOG.slice(1)]);
  });

  it('offers a leader no way into the picker', async () => {
    mount(RANK.LEADER);
    await screen.findByText('The First Million');
    expect(screen.queryByText('Choose a challenge')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('still shows the leader what is left, inline, which is why the button went', async () => {
    mount(RANK.LEADER);
    await screen.findByText('The First Million');
    // The shelf is empty in this fixture, so the heading is the
    // no-trophies variant. It becomes STILL OUT THERE once one is won.
    expect(screen.getByText("WHAT'S OUT THERE")).toBeTruthy();
    expect(screen.getByText('The Century')).toBeTruthy();
    expect(screen.getByText('The Foundry')).toBeTruthy();
  });

  it('gives a member no control either', async () => {
    mount(RANK.MEMBER);
    await screen.findByText('The First Million');
    expect(screen.queryByText('Choose a challenge')).toBeNull();
  });
});

describe('the ladder', () => {
  it('renders locked rows rather than filtering them out', async () => {
    mount(RANK.MEMBER);
    expect(await screen.findByText('The Foundry')).toBeTruthy();
    expect(screen.getByText('Lv. 3')).toBeTruthy();
    expect(screen.getByText('More unlock as the crew levels up.')).toBeTruthy();
  });

  it('shows the ladder on an empty shelf instead of a zero', async () => {
    mount(RANK.MEMBER);
    await screen.findByText('TROPHY SHELF');
    // No count is rendered at zero, and the copy invites rather than
    // reporting nothing.
    expect(screen.getByText(/No trophies yet/)).toBeTruthy();
    expect(screen.getByText("WHAT'S OUT THERE")).toBeTruthy();
    expect(screen.getByText('The First Million')).toBeTruthy();
  });

  it('names each target in its own units', async () => {
    mount(RANK.MEMBER);
    expect(await screen.findByText('1,000,000 lb')).toBeTruthy();
    expect(screen.getByText('100 sessions')).toBeTruthy();
  });
});

describe('the shelf', () => {
  it('lists earned trophies and switches the heading to what is left', async () => {
    getCrewTrophies.mockResolvedValue([
      { trophy_id: 'crew_thirty_days', title: 'Unbroken', earned_at: '2026-08-12T00:00:00Z' },
    ]);
    mount(RANK.MEMBER);
    expect(await screen.findByText('Unbroken')).toBeTruthy();
    expect(screen.getByText('STILL OUT THERE')).toBeTruthy();
    expect(screen.queryByText("WHAT'S OUT THERE")).toBeNull();
  });

  it('drops the contribution list once the shelf carries weight', async () => {
    const active = row({
      template_key: 'first_million', title: 'The First Million', trophy_title: 'Millionaires',
      state: 'active', current_value: 340120, target_value: 1000000, challenge_id: 'ch1',
    });
    getChallengeContributions.mockResolvedValue([{ user_id: 'u1', username: 'kegan', value: 204000 }]);

    // Big form: no trophies yet, so the chase is the subject of the page.
    getCrewChallengeCatalog.mockResolvedValue([active]);
    const big = mount(RANK.MEMBER);
    expect(await screen.findByText("WHO'S CARRYING IT")).toBeTruthy();
    big.unmount();

    // Compact form: a trophy on the shelf, so the chase is one status line.
    getCrewTrophies.mockResolvedValue([
      { trophy_id: 'x', title: 'Centurions', earned_at: '2026-07-28T00:00:00Z' },
    ]);
    mount(RANK.MEMBER);
    await screen.findByText('The First Million');
    expect(screen.queryByText("WHO'S CARRYING IT")).toBeNull();
  });
});

describe('monogram', () => {
  it('takes the initials of the first two words', () => {
    expect(monogram('The First Million')).toBe('TF');
    expect(monogram('Millionaires')).toBe('MI');
  });

  it('never throws on the values a catalog row can actually hold', () => {
    // A trophy_title is NOT NULL server-side, but this renders inside a
    // list that also draws rows the client built optimistically.
    expect(monogram('')).toBe('??');
    expect(monogram(null)).toBe('??');
    expect(monogram('   ')).toBe('??');
  });
});
