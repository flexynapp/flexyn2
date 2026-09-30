/**
 * Second profile audit (2026-09-30, after batches 1 and 2). Source guards for
 * what a unit test can't reach without mounting the whole page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (rel) => readFileSync(resolve(process.cwd(), rel), 'utf8');
const profile = read('src/components/hub/HubProfile.jsx');
const hero = read('src/components/hub/profile/useHeroContests.js');
const lifts = read('src/components/hub/ProfileLiftStats.jsx');

describe('profile audit, round 2', () => {
  it('draws the QR code on the device, never through a third-party service', () => {
    expect(profile).not.toMatch(/api\.qrserver\.com/);
    expect(profile).toMatch(/import\('qrcode'\)/);
  });

  it('translates the presence line and never compares against English', () => {
    expect(profile).not.toMatch(/'Active now'\s*\?/);
    expect(profile).not.toMatch(/text === 'Active now'/);
    expect(profile).toMatch(/hub\.profile\.activeNow/);
    expect(profile).toMatch(/hub\.profile\.activeHoursAgo/);
  });

  it('has no untranslated edit profile labels', () => {
    expect(profile).not.toMatch(/'Save profile'\s*\}/);
    expect(profile).not.toMatch(/\? 'Change flag'/);
    expect(profile).not.toMatch(/aria-label=\{noteLiked \? 'Unlike note'/);
  });

  it('keeps the League row while the week is still unranked', () => {
    expect(hero).not.toMatch(/if \(!res\?\.myRank\) return null/);
    expect(profile).toMatch(/profile\.leagueUnranked/);
  });

  it('dates share card workouts at local noon, not UTC midnight', () => {
    expect(lifts).not.toMatch(/new Date\(l\.date\)\.toLocaleDateString/);
    expect(lifts).toMatch(/T12:00:00/);
  });
});
