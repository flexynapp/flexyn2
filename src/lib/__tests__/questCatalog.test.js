import { describe, it, expect } from 'vitest';
import {
  QUEST_CATALOG,
  QUEST_DIFFICULTY,
  ACTION_TYPES,
  pickDailyQuests,
  getQuestDefinition,
} from '../questCatalog';

describe('QUEST_CATALOG', () => {
  it('every entry has the required fields', () => {
    Object.entries(QUEST_CATALOG).forEach(([id, q]) => {
      expect(q.difficulty, `${id} difficulty`).toMatch(/^(easy|medium|hard)$/);
      expect(q.target, `${id} target`).toBeGreaterThan(0);
      expect(q.actionType, `${id} actionType`).toBeTruthy();
      expect(typeof q.label).toBe('string');
      expect(typeof q.icon).toBe('string');
    });
  });

  it('every actionType maps to one in ACTION_TYPES', () => {
    const validActions = new Set(Object.values(ACTION_TYPES));
    Object.entries(QUEST_CATALOG).forEach(([id, q]) => {
      expect(validActions.has(q.actionType), `${id} uses unknown action ${q.actionType}`).toBe(true);
    });
  });

  it('has at least one enabled quest of each difficulty', () => {
    const enabled = Object.values(QUEST_CATALOG).filter(q => q.enabled);
    ['easy', 'medium', 'hard'].forEach(diff => {
      expect(enabled.some(q => q.difficulty === diff), `no ${diff} quest enabled`).toBe(true);
    });
  });
});

describe('QUEST_DIFFICULTY rewards', () => {
  it('has positive coin rewards in ascending order', () => {
    expect(QUEST_DIFFICULTY.easy.coinReward).toBeGreaterThan(0);
    expect(QUEST_DIFFICULTY.medium.coinReward).toBeGreaterThan(QUEST_DIFFICULTY.easy.coinReward);
    expect(QUEST_DIFFICULTY.hard.coinReward).toBeGreaterThan(QUEST_DIFFICULTY.medium.coinReward);
  });
});

describe('pickDailyQuests', () => {
  const userId = 'user-uuid-1';

  it('returns exactly one quest per difficulty', () => {
    const quests = pickDailyQuests(userId, '2026-01-15');
    expect(quests).toHaveLength(3);
    const diffs = quests.map(q => q.difficulty).sort();
    expect(diffs).toEqual(['easy', 'hard', 'medium']);
  });

  it('is deterministic — same inputs always return the same set', () => {
    const a = pickDailyQuests(userId, '2026-01-15');
    const b = pickDailyQuests(userId, '2026-01-15');
    expect(a.map(q => q.id)).toEqual(b.map(q => q.id));
  });

  it('different dates produce different (or sometimes same — hash-driven) selections', () => {
    // Sample several dates and confirm at least 2 distinct sets across 30 days —
    // a deterministic hash would never produce all-identical sets.
    const sets = new Set();
    for (let d = 1; d <= 30; d++) {
      const date = `2026-01-${String(d).padStart(2, '0')}`;
      const ids = pickDailyQuests(userId, date).map(q => q.id).join('|');
      sets.add(ids);
    }
    expect(sets.size).toBeGreaterThan(1);
  });

  it('different users produce independent selections', () => {
    const a = pickDailyQuests('user-1', '2026-01-15');
    const b = pickDailyQuests('user-2', '2026-01-15');
    // Possible they pick the same quests by coincidence — but at least they
    // both succeed and produce valid sets.
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
  });
});

describe('getQuestDefinition', () => {
  it('returns the full def with coinReward derived from difficulty', () => {
    const def = getQuestDefinition('log_meal');
    expect(def).toBeTruthy();
    expect(def.id).toBe('log_meal');
    expect(def.coinReward).toBe(QUEST_DIFFICULTY.easy.coinReward);
  });

  it('returns null for unknown quest ids', () => {
    expect(getQuestDefinition('nonexistent_quest')).toBeNull();
  });
});
