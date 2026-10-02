import { describe, it, expect } from 'vitest';
import {
  trainingPattern, duelGlance, warGlance, questGlance, goalGlance, fuelGlance, orderHeroSlides,
  MAX_SLIDES, PATTERN_MIN_SESSIONS,
} from '@/lib/heroGlance';

const NOW = new Date(2026, 9, 2, 12); // Friday 2 Oct 2026
const day = (offset) => {
  const d = new Date(NOW.getTime() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('trainingPattern', () => {
  it('needs enough sessions over enough weeks', () => {
    const logs = [0, -1, -2, -3, -4].map((o) => ({ date: day(o) }));
    expect(logs.length).toBeLessThan(PATTERN_MIN_SESSIONS);
    expect(trainingPattern({ logs, now: NOW })).toBeNull();
    // Six sessions crammed into one week are a busy week, not a habit.
    const oneWeek = [0, -1, -2, -3, -4, -5].map((o) => ({ date: day(o) }));
    expect(trainingPattern({ logs: oneWeek, now: NOW })).toBeNull();
  });

  it('counts days Monday first and names the top day', () => {
    // Mondays: 28 Sep, 21 Sep, 14 Sep; Thursday 1 Oct, 24 Sep; Saturday 19 Sep.
    const logs = [-4, -11, -18, -1, -8, -13].map((o) => ({ date: day(o), created_at: `${day(o)}T18:20:00` }));
    const p = trainingPattern({ logs, now: NOW });
    expect(p.counts).toEqual([3, 0, 0, 2, 0, 1, 0]);
    expect(p.topDays).toEqual([0]);
    expect(p.usualHour).toBe(18.5);
  });

  it('counts two sessions on one day once, lifting and cardio together', () => {
    const logs = [-4, -11, -18, -25].map((o) => ({ date: day(o) }));
    const cardioLogs = [-4, -1, -8].map((o) => ({ date: day(o) }));
    const p = trainingPattern({ logs, cardioLogs, now: NOW });
    expect(p.sessions).toBe(6);
    expect(p.counts[0]).toBe(4);
  });
});

describe('duelGlance', () => {
  const base = {
    id: 'd', status: 'active', type: 'open', challenger_id: 'me', opponent_id: 'them',
    challenger_result: { volume: 1000 }, opponent_result: { volume: 1500 },
    expires_at: new Date(NOW.getTime() + 3_600_000).toISOString(),
  };
  it('reads the viewer side whichever role they hold', () => {
    expect(duelGlance(base, 'me', NOW)).toMatchObject({ mine: 1000, theirs: 1500, unit: 'lbs' });
    expect(duelGlance(base, 'them', NOW)).toMatchObject({ mine: 1500, theirs: 1000 });
  });
  it('races a Mirror duel in sets', () => {
    const g = duelGlance({ ...base, type: 'mirror', challenger_result: { sets_completed: 4 } }, 'me', NOW);
    expect(g).toMatchObject({ unit: 'sets', mine: 4, theirs: 0 });
  });
  it('drops an expired duel', () => {
    expect(duelGlance({ ...base, expires_at: new Date(NOW.getTime() - 1).toISOString() }, 'me', NOW)).toBeNull();
  });
});

describe('warGlance and questGlance', () => {
  it('passes the war through with time left', () => {
    const w = warGlance({ crewId: 'c', mine: '10', theirs: 4, endsAt: new Date(NOW.getTime() + 60_000).toISOString() }, NOW);
    expect(w).toMatchObject({ mine: 10, theirs: 4, msLeft: 60_000 });
    expect(warGlance(null)).toBeNull();
  });
  it('counts done and unclaimed quests', () => {
    const q = questGlance([
      { quest_id: 'a', completed_at: 'x', claimed_at: 'x' },
      { quest_id: 'b', completed_at: 'x' },
      { quest_id: 'c' },
    ]);
    expect(q).toMatchObject({ done: 2, total: 3, unclaimed: 1 });
    expect(questGlance([])).toBeNull();
  });
});

describe('fuelGlance', () => {
  const targets = { calories: 2000, protein_g: 150, carbs_g: 200, fat_g: 60 };
  it('stays hidden for someone who does not track food', () => {
    expect(fuelGlance({ calories: 0, targets, tracksFood: false })).toBeNull();
  });
  it('shows before the first meal for someone who tracks food', () => {
    expect(fuelGlance({ calories: 0, targets, tracksFood: true })).toMatchObject({ left: 2000 });
  });
  it('goes negative when over target', () => {
    expect(fuelGlance({ calories: 2300, macros: { protein: 120 }, targets })).toMatchObject({ left: -300, protein: { have: 120, target: 150 } });
  });
});

describe('goalGlance', () => {
  it('ignores inactive goals and returns null with none', () => {
    expect(goalGlance({ goals: [{ status: 'completed' }] })).toBeNull();
  });
});

describe('orderHeroSlides', () => {
  const ready = { kind: 'strength', ready: true };
  const notReady = { kind: 'strength', ready: false };
  it('orders contests first and caps the list', () => {
    const ids = orderHeroSlides({
      duel: {}, war: {}, fuel: {}, quests: {}, goal: {}, pattern: {},
      trends: [ready, { kind: 'weight', ready: true }],
    }).map((s) => s.id);
    expect(ids).toEqual(['duel', 'war', 'fuel', 'quests', 'goal', 'pattern', 'trend-strength'].slice(0, MAX_SLIDES - 1));
  });
  it('keeps the not-ready trend only when the hero would otherwise be bare', () => {
    expect(orderHeroSlides({ quests: {}, trends: [notReady] }).map((s) => s.id)).toEqual(['quests', 'trend-strength']);
    expect(orderHeroSlides({ quests: {}, goal: {}, trends: [notReady] }).map((s) => s.id)).toEqual(['quests', 'goal']);
  });
});
