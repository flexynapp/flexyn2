import { describe, it, expect } from 'vitest';
import {
  TIERS,
  MAX_LEAGUE_SIZE,
  MIN_QUALIFIED_TO_MOVE,
  DECAY_GRACE_WEEKS,
  SHIELD_LIFETIME_CAP,
  getTier,
  nextTier,
  previousTier,
  promoteCount,
  demoteCount,
  isQualified,
  resolveStanding,
  outcomeLabel,
  leagueLevel,
  levelNumeral,
  leagueTierName,
} from '../leagueTiers';

describe('TIERS configuration', () => {
  it('has six tiers in ascending order', () => {
    expect(TIERS.map(t => t.id)).toEqual([
      'bronze', 'silver', 'gold', 'platinum', 'diamond', 'legend',
    ]);
  });

  it('every tier has the required fields', () => {
    TIERS.forEach((tier, i) => {
      expect(tier.id, `tier ${i}`).toBeTruthy();
      expect(tier.label, `tier ${i}`).toBeTruthy();
      expect(typeof tier.promotePct).toBe('number');
      expect(typeof tier.demotePct).toBe('number');
      expect(typeof tier.minWorkouts).toBe('number');
      expect(typeof tier.minXp).toBe('number');
      expect(typeof tier.rewardCoins).toBe('number');
      expect(tier.rewardCoins).toBeGreaterThanOrEqual(0);
    });
  });

  it('promotion tightens as you climb', () => {
    // Bronze is the widest gate; Legend is terminal. Everything between must
    // be monotonically harder, or a tier stops meaning anything.
    const pcts = TIERS.filter(t => t.id !== 'legend').map(t => t.promotePct);
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i], `promotePct at ${TIERS[i].id}`).toBeLessThan(pcts[i - 1]);
    }
  });

  it('minXp is zero on every tier — the floor is deliberately switched off', () => {
    // Guard against someone setting a plausible-looking XP floor from a guess.
    // The production ledger (10 user-weeks, median 23 XP) cannot support one,
    // and any value in the hundreds disqualifies every real user.
    TIERS.forEach(t => expect(t.minXp, `minXp at ${t.id}`).toBe(0));
  });

  it('rewards scale up by tier', () => {
    const rewards = TIERS.map(t => t.rewardCoins);
    for (let i = 1; i < rewards.length; i++) {
      expect(rewards[i], `reward at tier ${TIERS[i].id}`).toBeGreaterThan(rewards[i - 1]);
    }
  });

  it('bronze cannot demote', () => {
    expect(getTier('bronze').demotePct).toBe(0);
  });

  it('legend cannot promote (already at top)', () => {
    expect(getTier('legend').promotePct).toBe(0);
  });

  it('MAX_LEAGUE_SIZE is a sensible number', () => {
    expect(MAX_LEAGUE_SIZE).toBeGreaterThan(0);
    expect(MAX_LEAGUE_SIZE).toBeLessThanOrEqual(100);
  });

  it('exports the constants the server mirrors', () => {
    expect(MIN_QUALIFIED_TO_MOVE).toBe(5);
    expect(DECAY_GRACE_WEEKS).toBe(2);
    expect(SHIELD_LIFETIME_CAP).toBe(3);
  });
});

describe('getTier / nextTier / previousTier', () => {
  it('getTier returns the matching tier', () => {
    expect(getTier('bronze').label).toBe('Bronze');
    expect(getTier('legend').label).toBe('Legend');
  });

  it('getTier falls back to bronze for unknown ids', () => {
    expect(getTier('unknown').id).toBe('bronze');
  });

  it('nextTier returns the next tier up', () => {
    expect(nextTier('bronze').id).toBe('silver');
    expect(nextTier('gold').id).toBe('platinum');
  });

  it('nextTier returns null at legend', () => {
    expect(nextTier('legend')).toBeNull();
  });

  it('previousTier returns the next tier down', () => {
    expect(previousTier('silver').id).toBe('bronze');
    expect(previousTier('legend').id).toBe('diamond');
  });

  it('previousTier returns null at bronze', () => {
    expect(previousTier('bronze')).toBeNull();
  });
});

describe('promoteCount / demoteCount — proportional bands', () => {
  it('matches the server for a 12-strong gold bracket', () => {
    // Verified against roll_weekly_leagues() on a seeded bracket:
    // 12 qualified at gold -> 4 promote, 1 demote.
    expect(promoteCount('gold', 12)).toBe(4);
    expect(demoteCount('gold', 12)).toBe(1);
  });

  it('nobody moves below the minimum qualified field', () => {
    // This is what stops a solo bronze bracket walking one person to Legend.
    for (let n = 0; n < MIN_QUALIFIED_TO_MOVE; n++) {
      expect(promoteCount('bronze', n), `n=${n}`).toBe(0);
      expect(demoteCount('gold', n), `n=${n}`).toBe(0);
    }
    expect(promoteCount('bronze', MIN_QUALIFIED_TO_MOVE)).toBeGreaterThan(0);
  });

  it('always advances at least one from a qualifying bracket', () => {
    // ceil() plus the GREATEST(1, …) floor. Without it the smallest brackets
    // would stall permanently at the bottom of the ladder.
    expect(promoteCount('diamond', 5)).toBe(1);
  });

  it('legend never promotes at any size', () => {
    [5, 12, 30].forEach(n => expect(promoteCount('legend', n), `n=${n}`).toBe(0));
  });

  it('bronze never demotes at any size', () => {
    [5, 12, 30].forEach(n => expect(demoteCount('bronze', n), `n=${n}`).toBe(0));
  });

  it('demotion rounds in the user favour', () => {
    // floor(), not ceil() — 30 * 0.15 = 4.5 demotes four, not five.
    expect(demoteCount('gold', 30)).toBe(4);
  });

  it('zones never overlap, at any bracket size', () => {
    // A rank in both bands would make the outcome depend on branch order.
    TIERS.forEach(t => {
      for (let n = MIN_QUALIFIED_TO_MOVE; n <= 30; n++) {
        const p = promoteCount(t.id, n);
        const d = demoteCount(t.id, n);
        expect(p + d, `${t.id} at n=${n}`).toBeLessThanOrEqual(n);
      }
    });
  });
});

describe('isQualified', () => {
  it('trusts the server stamp when present', () => {
    expect(isQualified('gold', { qualified: true, active_days: 0 })).toBe(true);
    expect(isQualified('gold', { qualified: false, active_days: 9 })).toBe(false);
  });

  it('needs the tier minimum days when unstamped', () => {
    expect(isQualified('gold', { active_days: 1 })).toBe(false);   // gold needs 2
    expect(isQualified('gold', { active_days: 2 })).toBe(true);
    expect(isQualified('bronze', { active_days: 1 })).toBe(true);  // bronze needs 1
  });

  it('XP alone never qualifies anyone', () => {
    // The headline rule. An idle account with incidental XP is not competing.
    expect(isQualified('bronze', { active_days: 0, weekly_xp: 999999 })).toBe(false);
  });

  it('handles missing input safely', () => {
    expect(isQualified('bronze', null)).toBe(false);
    expect(isQualified('bronze', {})).toBe(false);
  });
});

describe('resolveStanding', () => {
  it('promotes top finishers from silver to gold', () => {
    const result = resolveStanding('silver', 1, 20);
    expect(result.outcome).toBe('promote');
    expect(result.newTier).toBe('gold');
    expect(result.coinsAwarded).toBeGreaterThan(0);
  });

  it('pays first place a 1.5x purse', () => {
    const first = resolveStanding('gold', 1, 12);
    const second = resolveStanding('gold', 2, 12);
    expect(first.coinsAwarded).toBe(300);   // 200 * 3 / 2
    expect(second.coinsAwarded).toBe(200);
  });

  it('demotes bottom finishers from gold to silver', () => {
    const result = resolveStanding('gold', 12, 12);
    expect(result.outcome).toBe('demote');
    expect(result.newTier).toBe('silver');
    expect(result.coinsAwarded).toBe(0);
  });

  it('a shield converts a demotion into a hold', () => {
    const result = resolveStanding('gold', 12, 12, { hasShield: true });
    expect(result.outcome).toBe('hold');
    expect(result.newTier).toBe('gold');
    expect(result.shielded).toBe(true);
  });

  it('pays qualified mid-table finishers a participation share', () => {
    // This paid zero before migration 310, which is most of a bracket
    // receiving no signal that the week happened.
    const result = resolveStanding('gold', 6, 12);
    expect(result.outcome).toBe('hold');
    expect(result.newTier).toBe('gold');
    expect(result.coinsAwarded).toBe(50);   // 200 / 4
  });

  it('NEVER promotes an unqualified member, whatever their rank or XP', () => {
    // The bug this whole change exists to fix.
    const result = resolveStanding('bronze', 1, 20, { qualified: false });
    expect(result.outcome).toBe('unranked');
    expect(result.newTier).toBe('bronze');
    expect(result.coinsAwarded).toBe(0);
    expect(result.capsuleAwarded).toBeNull();
  });

  it('holds everyone when the qualified field is too small', () => {
    // 4 qualified at gold: below MIN_QUALIFIED_TO_MOVE, so first place holds.
    const first = resolveStanding('gold', 1, 4);
    expect(first.outcome).toBe('hold');
    expect(first.newTier).toBe('gold');
    const last = resolveStanding('gold', 4, 4);
    expect(last.outcome).toBe('hold');
    expect(last.newTier).toBe('gold');
  });

  it('bronze never demotes — bottom rank stays bronze', () => {
    const result = resolveStanding('bronze', 20, 20);
    expect(result.outcome).toBe('hold');
    expect(result.newTier).toBe('bronze');
  });

  it('legend cannot promote', () => {
    const top = resolveStanding('legend', 1, 20);
    expect(top.outcome).toBe('hold');
    expect(top.newTier).toBe('legend');
  });

  it('legend bottom band demotes to diamond', () => {
    const result = resolveStanding('legend', 20, 20);
    expect(result.outcome).toBe('demote');
    expect(result.newTier).toBe('diamond');
  });

  it('returns safe defaults for missing inputs', () => {
    expect(resolveStanding(null, 1, 10).outcome).toBe('hold');
    expect(resolveStanding('bronze', null, 10).outcome).toBe('hold');
    expect(resolveStanding('bronze', 1, 0).outcome).toBe('hold');
  });

  it('promotion gives a capsule once tier >= gold', () => {
    expect(resolveStanding('silver', 1, 20).capsuleAwarded).toBeNull();
    expect(resolveStanding('gold', 1, 20).capsuleAwarded).toBe('standard');
    expect(resolveStanding('platinum', 1, 20).capsuleAwarded).toBe('premium');
  });
});

describe('outcomeLabel', () => {
  it('returns human-readable strings', () => {
    expect(outcomeLabel('promote')).toBe('Promoted');
    expect(outcomeLabel('demote')).toBe('Demoted');
    expect(outcomeLabel('unranked')).toBe('Not qualified');
    expect(outcomeLabel('decayed')).toBe('Dropped for inactivity');
    expect(outcomeLabel('hold')).toBe('Held position');
  });
});

describe('leagueLevel', () => {
  const w = (tier, qualified) => ({ tier, qualified });

  it('starts at I with no history', () => {
    expect(leagueLevel('bronze', [])).toBe(1);
    expect(leagueLevel('bronze', undefined)).toBe(1);
  });

  it('adds a level for each qualified week in the current league', () => {
    expect(leagueLevel('silver', [w('silver', true)])).toBe(2);
    expect(leagueLevel('silver', [w('silver', true), w('silver', true)])).toBe(3);
  });

  it('does not count unqualified or voided weeks, but they do not end the stint', () => {
    expect(leagueLevel('gold', [w('gold', false), w('gold', null), w('gold', true)])).toBe(2);
  });

  it('stops at the first week spent in another league', () => {
    // Promoted from bronze last week: back to I, whatever bronze earned.
    expect(leagueLevel('silver', [w('bronze', true), w('bronze', true)])).toBe(1);
    expect(leagueLevel('silver', [w('silver', true), w('bronze', true), w('silver', true)])).toBe(2);
  });

  it('caps at IV', () => {
    expect(leagueLevel('legend', Array(9).fill(w('legend', true)))).toBe(4);
  });

  it('writes the level as a numeral that is the same in every locale', () => {
    expect([1, 2, 3, 4].map(levelNumeral)).toEqual(['I', 'II', 'III', 'IV']);
    expect(levelNumeral(7)).toBe('IV');
  });

  it('puts the level into the league name only when one is given', () => {
    const tf = (_k, en, vars) => en.replace(/\{(\w+)\}/g, (_, v) => vars?.[v] ?? '');
    expect(leagueTierName(getTier('gold'), tf)).toBe('Gold League');
    expect(leagueTierName(getTier('gold'), tf, 3)).toBe('Gold League III');
  });
});
