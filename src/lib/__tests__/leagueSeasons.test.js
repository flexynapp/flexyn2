import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  daysLeftInSeason,
  isSeasonEligible,
  hasSeenSeasonResult,
  markSeasonResultSeen,
  seasonResultSeenKey,
} from '@/lib/data/leagueSeasons';
import { getTrophy, parseSeasonTrophy, TROPHIES, TROPHY_TIERS } from '@/lib/trophyDefinitions';

describe('daysLeftInSeason', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-08T12:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('floors rather than rounds', () => {
    // 30 hours left must never render as "1 day" — the roll is when rewards
    // land, and people plan their last session around the number shown.
    const season = { ends_at: '2026-08-09T18:00:00Z' };
    expect(daysLeftInSeason(season)).toBe(1);
  });

  it('returns 0 once the end has passed', () => {
    expect(daysLeftInSeason({ ends_at: '2026-08-07T00:00:00Z' })).toBe(0);
  });

  it('counts a full 28-day season', () => {
    expect(daysLeftInSeason({ ends_at: '2026-09-05T12:00:00Z' })).toBe(28);
  });

  it('returns null for missing or malformed input', () => {
    expect(daysLeftInSeason(null)).toBeNull();
    expect(daysLeftInSeason({})).toBeNull();
    expect(daysLeftInSeason({ ends_at: 'not-a-date' })).toBeNull();
  });
});

describe('isSeasonEligible', () => {
  it('needs the server-stated number of qualifying weeks', () => {
    expect(isSeasonEligible({ weeks_qualified: 1, weeks_needed: 2 })).toBe(false);
    expect(isSeasonEligible({ weeks_qualified: 2, weeks_needed: 2 })).toBe(true);
    expect(isSeasonEligible({ weeks_qualified: 4, weeks_needed: 2 })).toBe(true);
  });

  it('defaults to 2 weeks when the server omits the bar', () => {
    expect(isSeasonEligible({ weeks_qualified: 1 })).toBe(false);
    expect(isSeasonEligible({ weeks_qualified: 2 })).toBe(true);
  });

  it('is false for a missing season', () => {
    expect(isSeasonEligible(null)).toBe(false);
    expect(isSeasonEligible(undefined)).toBe(false);
  });
});

describe('season-result seen flag', () => {
  const UID = 'u-1';
  beforeEach(() => localStorage.clear());

  it('is unseen the first time and seen after marking', () => {
    expect(hasSeenSeasonResult(UID, 3)).toBe(false);
    markSeasonResultSeen(UID, 3);
    expect(hasSeenSeasonResult(UID, 3)).toBe(true);
  });

  it('a NEW season is unseen even after the previous one was marked', () => {
    markSeasonResultSeen(UID, 3);
    expect(hasSeenSeasonResult(UID, 4)).toBe(false);
  });

  it('is namespaced per user, so a shared phone does not swallow a ceremony', () => {
    markSeasonResultSeen(UID, 3);
    expect(hasSeenSeasonResult('u-2', 3)).toBe(false);
    expect(seasonResultSeenKey(UID)).toBe('flexyn.seenSeasonResult.u-1');
  });

  it('treats missing input as seen rather than replaying forever', () => {
    expect(hasSeenSeasonResult(null, 3)).toBe(true);
    expect(hasSeenSeasonResult(UID, null)).toBe(true);
  });

  it('survives storage being unavailable', () => {
    // Spy on the INSTANCE, not Storage.prototype — jsdom installs localStorage
    // as an own property, so a prototype spy silently doesn't intercept and
    // the test passes against the real implementation instead of the mock.
    const getSpy = vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setSpy = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });

    // Private mode must not fire the ceremony on every mount.
    expect(hasSeenSeasonResult(UID, 3)).toBe(true);
    expect(() => markSeasonResultSeen(UID, 3)).not.toThrow();

    getSpy.mockRestore();
    setSpy.mockRestore();
  });
});

describe('season trophies resolve from their id', () => {
  it('parses a tier trophy', () => {
    const t = parseSeasonTrophy('league_s3_gold');
    expect(t).toMatchObject({ season: 3, kind: 'gold', isChampion: false, tier: 'gold' });
    expect(t.name).toBe('Season 3 Gold');
  });

  it('parses the champion trophy', () => {
    const t = parseSeasonTrophy('league_s12_champion');
    expect(t).toMatchObject({ season: 12, isChampion: true, tier: 'legendary' });
    expect(t.name).toBe('Champion, S12');
  });

  it('maps diamond onto the platinum ramp, since TROPHY_TIERS has no diamond', () => {
    expect(parseSeasonTrophy('league_s1_diamond').tier).toBe('platinum');
    expect(TROPHY_TIERS.diamond).toBeUndefined();
  });

  it('every resolved tier exists in TROPHY_TIERS', () => {
    // ProfileTrophies does TROPHY_TIERS[trophy.tier] and would render a blank
    // swatch for an unmapped one.
    ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'legend', 'champion'].forEach(k => {
      const t = parseSeasonTrophy(`league_s2_${k}`);
      expect(TROPHY_TIERS[t.tier], k).toBeTruthy();
    });
  });

  it('rejects ids that only look like season trophies', () => {
    expect(parseSeasonTrophy('league_s1_mythic')).toBeNull();
    expect(parseSeasonTrophy('league_sX_gold')).toBeNull();
    expect(parseSeasonTrophy('first_rep')).toBeNull();
    expect(parseSeasonTrophy(null)).toBeNull();
  });

  it('getTrophy resolves both catalog and season trophies', () => {
    expect(getTrophy('first_rep')?.name).toBe('First Rep');
    expect(getTrophy('league_s5_legend')?.name).toBe('Season 5 Legend');
    expect(getTrophy('nonsense')).toBeNull();
  });

  it('season trophies stay OUT of the static catalog', () => {
    // TROPHIES.length is the "x / N earned" denominator on the profile. A
    // denominator that grows every 28 days and can never be completed would
    // make the collection read as permanently unfinished.
    expect(TROPHIES.some(t => t.id.startsWith('league_s'))).toBe(false);
  });
});
