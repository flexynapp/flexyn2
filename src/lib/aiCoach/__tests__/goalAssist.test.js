import { describe, it, expect } from 'vitest';
import { buildGoalAssistMessage } from '../goalAssist';
import { detectIntent, INTENTS } from '../intents';

const today = new Date(2026, 8, 30); // Sep 30 2026, local

const bench = {
  id: 'g1', status: 'active', goal_type: 'strength',
  exercise_name: 'Bench Press', target_weight: 150, target_reps: 8,
  deadline: '2026-10-30', created_date: '2026-09-01T00:00:00Z',
};

describe('buildGoalAssistMessage', () => {
  it('states the target, the closest set and the days left', () => {
    const logs = [{
      created_date: '2026-09-10T00:00:00Z',
      exercises: [{ name: 'Bench Press', sets: [{ weight: 135, reps: 6 }, { weight: 95, reps: 10 }] }],
    }];
    const msg = buildGoalAssistMessage(bench, { logs, weightUnit: 'lbs', today });
    expect(msg).toContain('Bench Press, one set of 150 lbs x 8');
    expect(msg).toContain('closest to it so far is 135 x 6');
    expect(msg).not.toContain('heaviest');
    expect(msg).toContain('October 30, 2026, 30 days from now');
    expect(msg).toMatch(/Help me make a plan/);
  });

  it('names the heavier load when a lighter set is the closest', () => {
    const logs = [{
      created_date: '2026-09-10T00:00:00Z',
      exercises: [{ name: 'Bench Press', sets: [{ weight: 135, reps: 6 }, { weight: 125, reps: 8 }] }],
    }];
    const msg = buildGoalAssistMessage(bench, { logs, weightUnit: 'lbs', today });
    expect(msg).toContain('closest to it so far is 125 x 8');
    expect(msg).toContain('My heaviest set is 135 lbs, for fewer reps.');
  });

  it('says so when nothing has been logged yet', () => {
    const msg = buildGoalAssistMessage(bench, { logs: [], today });
    expect(msg).toContain('I have not logged a set of Bench Press since setting it.');
  });

  it('flags a date that has passed instead of counting negative days', () => {
    const msg = buildGoalAssistMessage({ ...bench, deadline: '2026-09-20' }, { today });
    expect(msg).toContain('My target date was September 20, 2026');
    expect(msg).not.toMatch(/-\d+ day/);
  });

  it('leaves the date out when the goal has none', () => {
    const msg = buildGoalAssistMessage({ ...bench, deadline: null }, { today });
    expect(msg).not.toMatch(/target date/i);
  });

  it('describes a weekly running distance goal with what is done this week', () => {
    const goal = {
      id: 'g2', status: 'active', goal_type: 'cardio_distance', cardio_activity: 'running',
      target_distance_meters: 16093.44, period: 'week', created_date: '2020-01-01T00:00:00Z',
    };
    const msg = buildGoalAssistMessage(goal, { cardioLogs: [], distanceUnit: 'mi', today });
    expect(msg).toContain('10.0 mi of running each week');
    expect(msg).toContain('I have not logged any toward it yet.');
  });

  it('reads as a plan request to the offline rules engine, so a capped guest still gets a session', () => {
    const msg = buildGoalAssistMessage(bench, { today });
    expect(detectIntent(msg).id).toBe(INTENTS.GENERATE_PLAN);
  });

  it('is English with no dashes, the Coach chip contract', () => {
    const msg = buildGoalAssistMessage(bench, { today });
    expect(msg).not.toMatch(/[—–]/);
  });
});
