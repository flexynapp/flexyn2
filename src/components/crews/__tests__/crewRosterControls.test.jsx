// Which controls a roster row offers, per viewer rank.
//
// The gating used to be one boolean —
//   currentUserRole === 'leader' && !isSelf && memberRole !== 'leader'
// — bundling promote, remove and ban together and giving moderators
// nothing. Migration 357 split those apart on the server, so the UI has
// to split them too: a control the server allows but the UI hides is the
// same defect as one the UI offers and the server refuses, just quieter.
//
// These assert the row, not the matrix. crewPermissions.test.js owns the
// matrix; this file owns the wiring between it and the buttons, which is
// where a rank prop threaded to the wrong place would show up.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ tFallback: (_k, fallback) => fallback }),
}));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/data/crews', () => ({
  setMemberRole: vi.fn(),
  removeMember:  vi.fn(),
}));
vi.mock('@/lib/data/crewMembership', () => ({ banMember: vi.fn() }));
vi.mock('../CrewJoinRequests',  () => ({ default: () => null }));
vi.mock('../CrewTreasuryPanel', () => ({ default: () => null }));

const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
const { default: CrewMemberDirectory } = await import('../CrewMemberDirectory');

const LEADER = { user_id: 'u-leader', role: 'leader',    is_admin: true,  username: 'kegan' };
const MOD    = { user_id: 'u-mod',    role: 'moderator', is_admin: false, username: 'marcus' };
const MOD2   = { user_id: 'u-mod2',   role: 'moderator', is_admin: false, username: 'priya' };
const MEMBER = { user_id: 'u-member', role: 'member',    is_admin: false, username: 'sam' };

const ROSTER = [LEADER, MOD, MOD2, MEMBER];

function show(currentUserId, isCurrentAdmin) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrewMemberDirectory
        crewId="c1"
        members={ROSTER}
        currentUserId={currentUserId}
        isCurrentAdmin={isCurrentAdmin}
        maxCapacity={16}
        inline
      />
    </QueryClientProvider>,
  );
}

const count = (label) => screen.queryAllByTitle(label).length;

beforeEach(() => vi.clearAllMocks());

describe('as a MEMBER (rank 1)', () => {
  it('offers no management control on anyone', () => {
    show('u-member', false);
    expect(count('Change role')).toBe(0);
    expect(count('Remove from crew')).toBe(0);
    expect(count('Ban from crew')).toBe(0);
  });
});

describe('as a MODERATOR (rank 2)', () => {
  it('may remove the one plain member, and nobody else', () => {
    show('u-mod', false);
    // Four rows: leader, self, peer moderator, member. Only the member
    // is below rank 2, and canActOn is strictly greater.
    expect(count('Remove from crew')).toBe(1);
  });

  it('cannot change ranks — that is the leader\'s', () => {
    show('u-mod', false);
    expect(count('Change role')).toBe(0);
  });

  it('cannot ban', () => {
    show('u-mod', false);
    expect(count('Ban from crew')).toBe(0);
  });
});

describe('as a LEADER (rank 3)', () => {
  it('may change the rank of both moderators and the member, but not their own', () => {
    show('u-leader', true);
    expect(count('Change role')).toBe(3);
  });

  it('may remove everyone below them', () => {
    show('u-leader', true);
    expect(count('Remove from crew')).toBe(3);
  });

  it('may ban', () => {
    show('u-leader', true);
    expect(count('Ban from crew')).toBe(3);
  });
});

describe('the viewer row is never actionable', () => {
  it('a leader gets no controls against themselves', () => {
    show('u-leader', true);
    // Three controls across three OTHER rows, so nothing landed on row one.
    expect(count('Remove from crew')).toBe(3);
    expect(ROSTER.length).toBe(4);
  });
});

describe('before the roster resolves', () => {
  it('a leader keeps their controls rather than losing them mid-load', () => {
    // currentMember is absent from the list, so rankOf() would be 0 and
    // strip every control from a real leader while the query is in flight.
    // isCurrentAdmin is the fallback.
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={qc}>
        <CrewMemberDirectory
          crewId="c1"
          members={[MOD, MEMBER]}
          currentUserId="u-leader-not-in-list"
          isCurrentAdmin
          maxCapacity={16}
          inline
        />
      </QueryClientProvider>,
    );
    expect(screen.queryAllByTitle('Remove from crew').length).toBe(2);
  });
});
