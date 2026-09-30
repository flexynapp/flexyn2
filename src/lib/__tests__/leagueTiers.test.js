import { describe, it, expect } from 'vitest';
import {
  TIERS,
  MAX_LEAGUE_SIZE,
  MIN_QUALIFIED_FOR_PRIZE,
  DEMOTE_MARGIN,
  SHIELD_LIFETIME_CAP,
  getTier,
  nextTier,
  previousTier,
  tierForScore,
  prizeCount,
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
      expect(typeof tier.strengthFloor).toBe('number');
      expect(typeof tier.prizePct).toBe('number');
      expect(typeof tier.minWorkouts).toBe('number');
      expect(typeof tier.rewardCoins).toBe('number');
      expect(tier.rewardCoins).toBeGreaterThanOrEqual(0);
    });
  });

  it('strength floors mirror league_tier_floor on the server', () => {
    // Change these only together with the migration's league_tier_floor.
    expect(TIERS.map(t => t.strengthFloor)).toEqual([0, 150, 250, 325, 400, 475]);
  });

  it('prize share narrows as you climb', () => {
    const pcts = TIERS.map(t => t.prizePct);
    for (let i = 1; i < pcts.length; i++) {
      expect(pcts[i], `prizePct at ${TIERS[i].id}`).toBeLessThanOrEqual(pcts[i - 1]);
    }
  });

  it('rewards scale up by tier', () => {
    const rewards = TIERS.map(t => t.rewardCoins);
    for (let i = 1; i < rewards.length; i++) {
      expect(rewards[i], `reward at tier ${TIERS[i].id}`).toBeGreaterThan(rewards[i - 1]);
    }
  });

  it('MAX_LEAGUE_SIZE is a sensible number', () => {
    expect(MAX_LEAGUE_SIZE).toBeGreaterThan(0);
    expect(MAX_LEAGUE_SIZE).toBeLessThanOrEqual(100);
  });

  it('exports the constants the server mirrors', () => {
    expect(MIN_QUALIFIED_FOR_PRIZE).toBe(5);
    expect(DEMOTE_MARGIN).toBe(0.9);
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

describe('tierForScore', () => {
  it('places a score in the highest tier whose floor it clears', () => {
    expect(tierForScore(0).id).toBe('bronze');
    expect(tierForScore(149.9).id).toBe('bronze');
    expect(tierForScore(150).id).toBe('silver');
    // 745 lb total at 165 lb bodyweight is about 243 DOTS: Silver.
    expect(tierForScore(243).id).toBe('silver');
    expect(tierForScore(269).id).toBe('gold');
    expect(tierForScore(475).id).toBe('legend');
    expect(tierForScore(900).id).toBe('legend');
  });

  it('treats a missing score as bronze', () => {
    expect(tierForScore(null).id).toBe('bronze');
    expect(tierForScore(undefined).id).toBe('bronze');
    expect(tierForScore('nope').id).toBe('bronze');
  });
});

describe('prizeCount', () => {
  it('pays nobody the top prize below the minimum qualified field', () => {
    for (let n = 0; n < MIN_QUALIFIED_FOR_PRIZE; n++) {
      expect(prizeCount('bronze', n), `n=${n}`).toBe(0);
    }
  });

  it('takes the tier share, rounded up, and never less than one', () => {
    expect(prizeCount('bronze', 5)).toBe(3);   // ceil(2.5)
    expect(prizeCount('gold', 12)).toBe(4);    // ceil(3.6)
    expect(prizeCount('legend', 5)).toBe(1);
    expect(prizeCount('legend', 30)).toBe(6);
  });

  it('never exceeds the field', () => {
    TIERS.forEach(t => {
      for (let n = MIN_QUALIFIED_FOR_PRIZE; n <= 30; n++) {
        expect(prizeCount(t.id, n), `${t.id} at n=${n}`).toBeLessThanOrEqual(n);
      }
    });
  });
});

describe('isQualified', () => {
  it('uses the member\'s own tier in a mixed bracket', () => {
    // A gold lifter racing in a bronze bracket still needs gold's two days.
    expect(isQualified('bronze', { tier: 'gold', active_days: 1 })).toBe(false);
    expect(isQualified('bronze', { tier: 'gold', active_days: 2 })).toBe(true);
  });

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
  it('pays the prize zone the full purse and first place 1.5x', () => {
    const first = resolveStanding('gold', 1, 12);
    const second = resolveStanding('gold', 2, 12);
    expect(first.outcome).toBe('top');
    expect(first.coinsAwarded).toBe(300);   // 200 * 3 / 2
    expect(first.capsuleAwarded).toBe('standard');
    expect(second.coinsAwarded).toBe(200);
  });

  it('pays everyone else who trained a quarter', () => {
    const result = resolveStanding('gold', 6, 12);
    expect(result.outcome).toBe('hold');
    expect(result.coinsAwarded).toBe(50);   // 200 / 4
    expect(result.capsuleAwarded).toBeNull();
  });

  it('never moves a tier, whatever the rank', () => {
    [1, 6, 12].forEach(rank => {
      const r = resolveStanding('gold', rank, 12);
      expect(r.newTier, `rank ${rank}`).toBeUndefined();
      expect(['top', 'hold']).toContain(r.outcome);
    });
  });

  it('pays nothing to an unqualified member, whatever their rank or XP', () => {
    const result = resolveStanding('bronze', 1, 20, { qualified: false });
    expect(result.outcome).toBe('unranked');
    expect(result.coinsAwarded).toBe(0);
    expect(result.capsuleAwarded).toBeNull();
  });

  it('holds the top prize when the qualified field is too small', () => {
    const first = resolveStanding('gold', 1, 4);
    expect(first.outcome).toBe('hold');
    expect(first.coinsAwarded).toBe(50);
  });

  it('pays the member\'s own tier and takes the prize share from the bracket', () => {
    // A gold lifter in a bronze bracket: bronze's 50% share, gold's purse.
    const r = resolveStanding('gold', 3, 6, { bracketTierId: 'bronze' });
    expect(r.outcome).toBe('top');
    expect(r.coinsAwarded).toBe(200);
  });

  it('returns safe defaults for missing inputs', () => {
    expect(resolveStanding(null, 1, 10).outcome).toBe('hold');
    expect(resolveStanding('bronze', null, 10).outcome).toBe('hold');
    expect(resolveStanding('bronze', 1, 0).outcome).toBe('hold');
  });
});

describe('outcomeLabel', () => {
  it('returns human-readable strings', () => {
    expect(outcomeLabel('top')).toBe('Prize zone');
    expect(outcomeLabel('promote')).toBe('Promoted');
    expect(outcomeLabel('demote')).toBe('Demoted');
    expect(outcomeLabel('unranked')).toBe('Not qualified');
    expect(outcomeLabel('decayed')).toBe('Dropped for inactivity');
    expect(outcomeLabel('hold')).toBe('Trained');
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
