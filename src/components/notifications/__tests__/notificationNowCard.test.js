import { describe, it, expect, vi } from 'vitest';

vi.mock('@/api/supabaseClient', () => ({ supabase: {} }));
vi.mock('@/lib/data/quests', () => ({ todayDateString: () => '', sortQuestRows: r => r, ensureTodaysQuests: async () => [] }));

const { liveItems, minutesToMidnight } = await import('../NotificationNowCard');

const NOW = new Date(2026, 8, 30, 21, 46);
const q = (progress, target, completed_at = null) => ({ progress, target, completed_at });

describe('minutesToMidnight', () => {
  it('counts to the next local midnight', () => {
    expect(minutesToMidnight(NOW)).toBe(134);
    expect(minutesToMidnight(new Date(2026, 8, 30, 23, 59, 30))).toBe(1);
  });
});

describe('liveItems', () => {
  it('shows nothing when nothing is live', () => {
    expect(liveItems({ now: NOW })).toEqual([]);
    expect(liveItems({ questRows: [q(1, 1), q(3, 3)], now: NOW })).toEqual([]);
  });

  it('counts quests done, by progress or by completion', () => {
    expect(liveItems({ questRows: [q(1, 1), q(0, 2, 'x'), q(0, 3)], now: NOW }))
      .toEqual([{ kind: 'quests', done: 2, total: 3 }]);
  });

  it('flags a streak only when the last workout was yesterday', () => {
    const at = (d) => liveItems({ streakProfile: { workout_streak: 5, last_workout_date: d }, now: NOW });
    expect(at('2026-09-29')).toEqual([{ kind: 'streak', streak: 5 }]);
    expect(at('2026-09-30')).toEqual([]);
    expect(at('2026-09-27')).toEqual([]);
    expect(liveItems({ streakProfile: { workout_streak: 1, last_workout_date: '2026-09-29' }, now: NOW })).toEqual([]);
  });

  it('shows today\'s pending session and ignores other days and finished ones', () => {
    const schedules = [
      { id: 'y', scheduled_date: '2026-09-29', status: 'notified' },
      { id: 'd', scheduled_date: '2026-09-30', status: 'completed' },
      { id: 't', scheduled_date: '2026-09-30', status: 'pending' },
    ];
    expect(liveItems({ schedules, now: NOW })).toEqual([{ kind: 'scheduled', session: schedules[2] }]);
  });

  it('orders streak, then session, then quests', () => {
    const items = liveItems({
      questRows: [q(0, 1)],
      streakProfile: { workout_streak: 3, last_workout_date: '2026-09-29' },
      schedules: [{ id: 't', scheduled_date: '2026-09-30', status: 'pending' }],
      now: NOW,
    });
    expect(items.map(i => i.kind)).toEqual(['streak', 'scheduled', 'quests']);
  });
});
