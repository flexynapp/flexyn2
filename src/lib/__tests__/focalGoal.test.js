/**
 * focalGoal — the rules behind hero option D's one number and its sentence.
 * Sentences are asserted as KEYS plus an interpolating render, never only as
 * English: a stub that returns the English fallback passes even when a var
 * goes missing (CLAUDE.md, "A translation without its vars renders a hole").
 */
import { describe, it, expect } from 'vitest';
import {
  weeklyTarget,
  weekSummary,
  weekHeadline,
  weekDetail,
  fuelSummary,
  fuelHeadline,
  fuelDetail,
  ringShare,
} from '@/lib/focalGoal';

// Interpolate a TEMPLATE, ignoring the fallback, so a missing var shows up
// as a literal {placeholder}.
const TEMPLATES = {
  'progress.focal.week.more': 'FALTAN {n}',
  'progress.focal.week.short': 'NO DA PARA {n}',
  'progress.focal.week.trainedOn': 'ENTRENASTE {days}',
  'progress.focal.week.planned_other': 'PLAN {n}',
  'progress.focal.week.lastWeek_other': 'PASADA {n}',
  'progress.focal.week.count_other': 'CUENTA {n}',
  'nutrition.focal.left': 'QUEDAN {n}',
  'nutrition.focal.over': 'SOBRAN {n}',
  'nutrition.focal.emptyDetail': 'META {n}',
  'nutrition.focal.meals_other': 'COMIDAS {n}',
  'nutrition.focal.proteinHit': 'PROT OK {n}',
};
const render = (desc) => (TEMPLATES[desc.key] || desc.key).replace(/\{(\w+)\}/g, (m, k) => (desc.vars && k in desc.vars ? String(desc.vars[k]) : m));

// Thursday 24 Sep 2026, local. Week runs Mon 21 → Sun 27.
const THU = new Date(2026, 8, 24, 18);
const w = (date) => ({ date, exercises: [] });
const profile4 = { training_days: ['0', '2', '4', '5'] };

describe('weeklyTarget', () => {
  it('is the number of distinct weekdays picked in onboarding', () => {
    expect(weeklyTarget(profile4)).toBe(4);
    expect(weeklyTarget({ training_days: [0, '0', 2] })).toBe(2);
  });
  it('is null, not a guessed 3, when unknown or garbage', () => {
    expect(weeklyTarget({})).toBeNull();
    expect(weeklyTarget({ training_days: [] })).toBeNull();
    expect(weeklyTarget({ training_days: 'mon,wed' })).toBeNull();
    expect(weeklyTarget({ training_days: ['9', 'x'] })).toBeNull();
    expect(weeklyTarget(null)).toBeNull();
  });
});

describe('weekSummary', () => {
  it('counts distinct LOCAL days since Monday and lays out the dots', () => {
    const s = weekSummary({ logs: [w('2026-09-22'), w('2026-09-22'), w('2026-09-24'), w('2026-09-20')], profile: profile4, now: THU });
    expect(s.done).toBe(2);
    expect(s.lastWeekDone).toBe(1);
    expect(s.trainedToday).toBe(true);
    expect(s.days.map((d) => d.done)).toEqual([false, true, false, true, false, false, false]);
    expect(s.days[3].today).toBe(true);
    expect(s.days.filter((d) => d.future).map((d) => d.index)).toEqual([4, 5, 6]);
    expect(s.slotsLeft).toBe(3); // Fri, Sat, Sun; today is already in
  });

  it('reads a Monday log as this week (no UTC parse)', () => {
    const s = weekSummary({ logs: [w('2026-09-21')], profile: profile4, now: new Date(2026, 8, 21, 0, 30) });
    expect(s.done).toBe(1);
  });
});

describe('weekHeadline', () => {
  const at = (dates, profile = profile4, now = THU) => weekSummary({ logs: dates.map(w), profile, now });

  it('brand new user: the first session, not a zero', () => {
    const h = weekHeadline(at([]));
    expect(h.key).toBe('progress.focal.week.first');
  });

  it('mid week, 2 of 4: how many more', () => {
    const h = weekHeadline(at(['2026-09-22', '2026-09-24']));
    expect(h.key).toBe('progress.focal.week.more');
    expect(render(h)).toBe('FALTAN 2');
  });

  it('one to go', () => {
    expect(weekHeadline(at(['2026-09-21', '2026-09-22', '2026-09-24'])).key).toBe('progress.focal.week.oneMore');
  });

  it('target met or passed: done, anything now is extra', () => {
    expect(weekHeadline(at(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'])).key).toBe('progress.focal.week.done');
    const five = weekSummary({ logs: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25'].map(w), profile: profile4, now: new Date(2026, 8, 25, 20) });
    expect(weekHeadline(five).key).toBe('progress.focal.week.done');
  });

  it('says so honestly when the days left cannot reach the target', () => {
    // Saturday evening, 1 of 4, trained today: only Sunday is left.
    const sat = new Date(2026, 8, 26, 20);
    const h = weekHeadline(weekSummary({ logs: [w('2026-09-26')], profile: profile4, now: sat }));
    expect(h.key).toBe('progress.focal.week.short');
    expect(render(h)).toBe('NO DA PARA 4');
  });

  it('unknown target: counts, never a ring sentence', () => {
    expect(weekHeadline(at([], {})).key).toBe('progress.focal.week.first');
    expect(weekHeadline(at(['2026-09-10'], {})).key).toBe('progress.focal.week.noneYet');
    expect(weekHeadline(at(['2026-09-22'], {})).key).toBe('progress.focal.week.count_one');
    const h = weekHeadline(at(['2026-09-22', '2026-09-23'], {}));
    expect(h.key).toBe('progress.focal.week.count_other');
    expect(render(h)).toBe('CUENTA 2');
  });
});

describe('weekDetail', () => {
  const at = (dates, profile = profile4) => weekSummary({ logs: dates.map(w), profile, now: THU });
  const names = (xs) => xs.map((i) => ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'][i]).join('+');

  it('names the days trained, through the caller\'s list formatter', () => {
    const d = weekDetail(at(['2026-09-22', '2026-09-24']), names);
    expect(render(d)).toBe('ENTRENASTE Tu+Th');
  });

  it('only today', () => {
    expect(weekDetail(at(['2026-09-24'])).key).toBe('progress.focal.week.trainedToday');
  });

  it('nothing yet this week: compares with last week', () => {
    expect(render(weekDetail(at(['2026-09-15', '2026-09-17'])))).toBe('PASADA 2');
    expect(weekDetail(at(['2026-09-15'])).key).toBe('progress.focal.week.lastWeek_one');
    expect(weekDetail(at(['2026-08-01'])).key).toBe('progress.focal.week.startToday');
  });

  it('brand new user: restates the plan they chose, or just invites', () => {
    expect(render(weekDetail(at([])))).toBe('PLAN 4');
    expect(weekDetail(at([], { training_days: ['2'] })).key).toBe('progress.focal.week.planned_one');
    expect(weekDetail(at([], {})).key).toBe('progress.focal.week.anyCounts');
  });
});

describe('fuel', () => {
  const targets = { calories: 2000, protein_g: 150 };

  it('no meals: an empty prompt, never 0 kcal', () => {
    const s = fuelSummary({ meals: [], targets });
    expect(s.logged).toBe(false);
    expect(fuelHeadline(s).key).toBe('nutrition.focal.empty');
    expect(render(fuelDetail(s))).toBe('META 2000');
  });

  it('under target: kcal left, and the meal count (protein has its own meter)', () => {
    const s = fuelSummary({ meals: [{ calories: 700, protein: 40 }, { calories: 540.4, protein_g: 20 }], targets });
    expect(s.kcal).toBe(1240);
    expect(s.protein).toBe(60);
    expect(render(fuelHeadline(s))).toBe('QUEDAN 760');
    expect(render(fuelDetail(s))).toBe('COMIDAS 2');
    expect(fuelDetail(fuelSummary({ meals: [{ calories: 300 }], targets })).key).toBe('nutrition.focal.meals_one');
  });

  it('within 5% either side reads as on target', () => {
    expect(fuelHeadline(fuelSummary({ meals: [{ calories: 1950 }], targets })).key).toBe('nutrition.focal.onTarget');
    expect(fuelHeadline(fuelSummary({ meals: [{ calories: 2090 }], targets })).key).toBe('nutrition.focal.onTarget');
  });

  it('over target', () => {
    expect(render(fuelHeadline(fuelSummary({ meals: [{ calories: 2400 }], targets })))).toBe('SOBRAN 400');
  });

  it('protein hit', () => {
    expect(render(fuelDetail(fuelSummary({ meals: [{ calories: 2000, protein: 160 }], targets })))).toBe('PROT OK 160');
  });

  it('a logged meal with no calories is still logged', () => {
    const s = fuelSummary({ meals: [{ food_name: 'Mystery', calories: null }], targets });
    expect(s.logged).toBe(true);
    expect(s.kcal).toBe(0);
  });
});

describe('ringShare', () => {
  it('clamps to 0..1 and is null without a target', () => {
    expect(ringShare(2, 4)).toBe(0.5);
    expect(ringShare(6, 4)).toBe(1);
    expect(ringShare(-1, 4)).toBe(0);
    expect(ringShare(2, 0)).toBeNull();
    expect(ringShare(2, null)).toBeNull();
  });
});
