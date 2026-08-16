// Tests for src/lib/crewPermissions.js — the crew rank matrix.
//
// This file pins the matrix so a widening cannot land quietly. A
// permission system fails silently in one direction only: nobody files a
// bug because a control they were not supposed to see appeared, so the
// regression that matters is a capability sliding DOWN a rank.
//
// The brief these assert against: a member types in crew chat and fights
// in wars but manages nothing and starts no wars; a moderator runs the
// crew day to day; a leader has everything.
//
// Enforcement is migration 357, not this module. These tests prove the UI
// agrees with the server, and the migration's own probe (run against
// production, rolled back) proves the server. Neither substitutes for the
// other — a matching client and a permissive database is exactly the
// shape the crew_members INSERT hole had.

import { describe, it, expect } from 'vitest';
import {
  RANK, CAPABILITY, can, memberCan, rankOf, rankLabel, canActOn, assignableRanks,
} from '../crewPermissions';

describe('rankOf', () => {
  it('reads the role name', () => {
    expect(rankOf({ role: 'leader' })).toBe(RANK.LEADER);
    expect(rankOf({ role: 'moderator' })).toBe(RANK.MODERATOR);
    expect(rankOf({ role: 'member' })).toBe(RANK.MEMBER);
  });

  it('falls back to is_admin on a row written before the role column', () => {
    expect(rankOf({ is_admin: true })).toBe(RANK.LEADER);
    expect(rankOf({ is_admin: false })).toBe(RANK.MEMBER);
  });

  it('prefers role over is_admin when both are present', () => {
    expect(rankOf({ role: 'moderator', is_admin: false })).toBe(RANK.MODERATOR);
  });

  it('floors an unrecognised role to member rather than throwing', () => {
    // A row we cannot classify must not be granted anything.
    expect(rankOf({ role: 'overlord' })).toBe(RANK.MEMBER);
    expect(rankOf({ role: null })).toBe(RANK.MEMBER);
  });

  it('gives a non-member rank 0, below every capability', () => {
    expect(rankOf(null)).toBe(0);
    expect(can(rankOf(null), 'SEND_MESSAGE')).toBe(false);
  });

  it('is case-insensitive on the role string', () => {
    expect(rankOf({ role: 'Leader' })).toBe(RANK.LEADER);
  });
});

describe('what a MEMBER may do', () => {
  const member = { role: 'member' };

  it('talks and fights', () => {
    expect(memberCan(member, 'SEND_MESSAGE')).toBe(true);
    expect(memberCan(member, 'REACT_TO_MESSAGE')).toBe(true);
    expect(memberCan(member, 'CONTRIBUTE_TO_WAR')).toBe(true);
    expect(memberCan(member, 'POST_STORY')).toBe(true);
    expect(memberCan(member, 'LEAVE_CREW')).toBe(true);
  });

  it('starts no wars — the brief names this one explicitly', () => {
    expect(memberCan(member, 'START_WAR')).toBe(false);
    expect(memberCan(member, 'CANCEL_WAR_QUEUE')).toBe(false);
  });

  it('manages nothing', () => {
    for (const capability of [
      'PIN_MESSAGE', 'DELETE_ANY_MESSAGE', 'ASSIGN_REGIMEN', 'CREATE_CHALLENGE',
      'KICK_MEMBER', 'PROMOTE_MEMBER', 'DEMOTE_MEMBER', 'EDIT_CREW_PROFILE',
      'MANAGE_TREASURY', 'DISBAND_CREW',
    ]) {
      expect([capability, memberCan(member, capability)]).toEqual([capability, false]);
    }
  });
});

describe('what a MODERATOR may do', () => {
  const mod = { role: 'moderator' };

  it('runs the crew day to day', () => {
    for (const capability of [
      'START_WAR', 'CANCEL_WAR_QUEUE', 'PIN_MESSAGE', 'DELETE_ANY_MESSAGE',
      'ASSIGN_REGIMEN', 'CREATE_CHALLENGE', 'START_ROLL_CALL', 'KICK_MEMBER',
    ]) {
      expect([capability, memberCan(mod, capability)]).toEqual([capability, true]);
    }
  });

  it('does not decide who runs it', () => {
    for (const capability of [
      'PROMOTE_MEMBER', 'DEMOTE_MEMBER', 'EDIT_CREW_PROFILE',
      'MANAGE_TREASURY', 'DISBAND_CREW',
    ]) {
      expect([capability, memberCan(mod, capability)]).toEqual([capability, false]);
    }
  });
});

describe('what a LEADER may do', () => {
  it('holds every capability in the matrix', () => {
    const denied = Object.keys(CAPABILITY).filter(c => !can(RANK.LEADER, c));
    expect(denied).toEqual([]);
  });
});

describe('the matrix itself', () => {
  it('grants an unknown capability to any member rather than nobody', () => {
    // Reading the roster, the chat and the war board are not privileges.
    // An unlisted capability defaulting to "denied" would make every new
    // read a leader-only feature by omission.
    expect(can(RANK.MEMBER, 'SOME_FUTURE_READ')).toBe(true);
    expect(can(0, 'SOME_FUTURE_READ')).toBe(false);
  });

  it('is monotonic — no capability is held by a lower rank than a higher one', () => {
    for (const capability of Object.keys(CAPABILITY)) {
      const held = [RANK.MEMBER, RANK.MODERATOR, RANK.LEADER].map(r => can(r, capability));
      // Once true it must stay true as rank climbs.
      expect([capability, held]).toEqual([
        capability,
        [...held].sort((a, b) => Number(a) - Number(b)),
      ]);
    }
  });
});

describe('canActOn', () => {
  it('requires strictly greater rank', () => {
    expect(canActOn(RANK.LEADER, RANK.MODERATOR)).toBe(true);
    expect(canActOn(RANK.MODERATOR, RANK.MEMBER)).toBe(true);
  });

  it('refuses peers — two moderators cannot eject each other', () => {
    expect(canActOn(RANK.MODERATOR, RANK.MODERATOR)).toBe(false);
    expect(canActOn(RANK.LEADER, RANK.LEADER)).toBe(false);
  });

  it('refuses acting upward', () => {
    expect(canActOn(RANK.MEMBER, RANK.MODERATOR)).toBe(false);
    expect(canActOn(RANK.MODERATOR, RANK.LEADER)).toBe(false);
  });
});

describe('assignableRanks', () => {
  it('lets a leader appoint a moderator', () => {
    expect(assignableRanks(RANK.LEADER, RANK.MEMBER)).toEqual([RANK.MODERATOR]);
  });

  it('lets a leader stand a moderator down', () => {
    expect(assignableRanks(RANK.LEADER, RANK.MODERATOR)).toEqual([RANK.MEMBER]);
  });

  it('never offers LEADER — handing over the crew is not a row in a list', () => {
    expect(assignableRanks(RANK.LEADER, RANK.MEMBER)).not.toContain(RANK.LEADER);
    expect(assignableRanks(RANK.LEADER, RANK.MODERATOR)).not.toContain(RANK.LEADER);
  });

  it('offers a moderator nothing', () => {
    expect(assignableRanks(RANK.MODERATOR, RANK.MEMBER)).toEqual([]);
  });

  it('offers nothing against a peer leader', () => {
    expect(assignableRanks(RANK.LEADER, RANK.LEADER)).toEqual([]);
  });
});

describe('rankLabel', () => {
  it('names each rank', () => {
    const t = (_k, fallback) => fallback;
    expect(rankLabel(RANK.LEADER, t)).toBe('Leader');
    expect(rankLabel(RANK.MODERATOR, t)).toBe('Moderator');
    expect(rankLabel(RANK.MEMBER, t)).toBe('Member');
  });

  it('works without a translator', () => {
    expect(rankLabel(RANK.MODERATOR)).toBe('Moderator');
  });
});
