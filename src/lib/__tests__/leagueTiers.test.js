import { describe, it, expect } from 'vitest';
import {
  TIERS,
  MAX_LEAGUE_SIZE,
  getTier,
  nextTier,
  previousTier,
  resolveStanding,
  outcomeLabel,
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
      expect(typeof tier.promote).toBe('number');
      expect(typeof tier.demote).toBe('number');
      expect(typeof tier.rewardCoins).toBe('number');
      expect(tier.rewardCoins).toBeGreaterThanOrEqual(0);
    });
  });

  it('rewards scale up by tier', () => {
    const rewards = TIERS.map(t => t.rewardCoins);
    for (let i = 1; i < rewards.length; i++) {
      expect(rewards[i], `reward at tier ${TIERS[i].id}`).toBeGreaterThan(rewards[i - 1]);
    }
  });

  it('bronze cannot demote', () => {
    expect(getTier('bronze').demote).toBe(0);
  });

  it('legend cannot promote (already at top)', () => {
    expect(getTier('legend').promote).toBe(0);
  });

  it('MAX_LEAGUE_SIZE is a sensible number', () => {
    expect(MAX_LEAGUE_SIZE).toBeGreaterThan(0);
    expect(MAX_LEAGUE_SIZE).toBeLessThanOrEqual(100);
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

describe('resolveStanding', () => {
  it('promotes top finishers from silver to gold', () => {
    // Silver: top 10 promote
    const result = resolveStanding('silver', 1, 30);
    expect(result.outcome).toBe('promote');
    expect(result.newTier).toBe('gold');
    expect(result.coinsAwarded).toBeGreaterThan(0);
  });

  it('demotes bottom finishers from gold to silver', () => {
    // Gold: bottom 5 demote
    const result = resolveStanding('gold', 30, 30);
    expect(result.outcome).toBe('demote');
    expect(result.newTier).toBe('silver');
    expect(result.coinsAwarded).toBe(0);
  });

  it('keeps middle finishers at the same tier with no coins', () => {
    const result = resolveStanding('silver', 15, 30);
    expect(result.outcome).toBe('stay');
    expect(result.newTier).toBe('silver');
    expect(result.coinsAwarded).toBe(0);
  });

  it('bronze never demotes — bottom rank stays bronze', () => {
    const result = resolveStanding('bronze', 30, 30);
    expect(result.outcome).toBe('stay');
    expect(result.newTier).toBe('bronze');
  });

  it('legend cannot promote, but top 3 still get the reward', () => {
    const top3 = resolveStanding('legend', 1, 30);
    expect(top3.outcome).toBe('stay');
    expect(top3.newTier).toBe('legend');
    expect(top3.coinsAwarded).toBeGreaterThan(0);
    expect(top3.capsuleAwarded).toBe('elite');
  });

  it('legend bottom 5 demote to diamond', () => {
    const result = resolveStanding('legend', 30, 30);
    expect(result.outcome).toBe('demote');
    expect(result.newTier).toBe('diamond');
  });

  it('returns safe defaults for missing inputs', () => {
    expect(resolveStanding(null, 1, 10).outcome).toBe('stay');
    expect(resolveStanding('bronze', null, 10).outcome).toBe('stay');
    expect(resolveStanding('bronze', 1, 0).outcome).toBe('stay');
  });

  it('promotion gives a capsule once tier ≥ gold', () => {
    expect(resolveStanding('silver', 1, 30).capsuleAwarded).toBeNull();
    expect(resolveStanding('gold',   1, 30).capsuleAwarded).toBe('standard');
    expect(resolveStanding('platinum', 1, 30).capsuleAwarded).toBe('premium');
  });
});

describe('outcomeLabel', () => {
  it('returns human-readable strings', () => {
    expect(outcomeLabel('promote')).toBe('Promoted');
    expect(outcomeLabel('demote')).toBe('Demoted');
    expect(outcomeLabel('stay')).toBe('Held position');
  });
});
