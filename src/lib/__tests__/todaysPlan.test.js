// The regimen the Today hero offers as its one button. The rotation rule
// is the one TodaysPlanCard always used; these pin it now that two
// surfaces depend on it.
import { describe, it, expect } from 'vitest';
import { findDueRegimen } from '@/lib/todaysPlan';

const push = { id: 1, name: 'Push' };
const pull = { id: 2, name: 'Pull' };
const legs = { id: 3, name: 'Legs' };
const log = (name, date) => ({ title: name, date });
const now = new Date(2026, 8, 24, 9);

describe('findDueRegimen', () => {
  it('offers nothing without a rotation', () => {
    expect(findDueRegimen([], [], now)).toBe(null);
    expect(findDueRegimen([push], [], now)).toBe(null);
    expect(findDueRegimen([push, { ...pull, archived: true }], [], now)).toBe(null);
  });

  it('picks the regimen used least recently', () => {
    const logs = [log('Push', '2026-09-22'), log('Pull', '2026-09-23'), log('Legs', '2026-09-21')];
    expect(findDueRegimen([push, pull, legs], logs, now).regimen).toBe(legs);
  });

  it('treats a regimen never logged as due first', () => {
    const logs = [log('Push', '2026-09-22'), log('Pull', '2026-09-23')];
    expect(findDueRegimen([push, pull, legs], logs, now).regimen).toBe(legs);
  });

  it('says when the due regimen was already done today', () => {
    const logs = [log('Push', '2026-09-24'), log('Pull', '2026-09-24')];
    expect(findDueRegimen([push, pull], logs, now).doneToday).toBe(true);
  });
});
