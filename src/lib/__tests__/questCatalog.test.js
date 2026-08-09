import { describe, it, expect } from 'vitest';
import {
  QUEST_CATALOG,
  QUEST_DIFFICULTY,
  DIFFICULTY_ORDER,
  ACTION_TYPES,
  PERFECT_DAY_BONUS,
  pickDailyQuests,
  getQuestDefinition,
  difficultyRank,
  questDestinationRoute,
} from '../questCatalog';
import { QUEST_ICONS } from '@/components/dashboard/questVisuals';

const TIERS = ['easy', 'medium', 'hard', 'crew'];

describe('QUEST_CATALOG', () => {
  it('every entry has the required fields', () => {
    Object.entries(QUEST_CATALOG).forEach(([id, q]) => {
      expect(TIERS, `${id} difficulty`).toContain(q.difficulty);
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

  // The mirror of the above, and the one that actually caught something:
  // `cardio_completed` was emitted by all three cardio surfaces and
  // subscribed to by NOTHING for months, so the action fired, matched zero
  // rows and returned. An action type nobody quests on is either a bug or
  // dead weight — either way the catalog should be the thing that says so.
  it('every ACTION_TYPE is subscribed to by at least one enabled quest', () => {
    const subscribed = new Set(
      Object.values(QUEST_CATALOG).filter(q => q.enabled).map(q => q.actionType),
    );
    Object.entries(ACTION_TYPES).forEach(([name, type]) => {
      expect(subscribed.has(type), `ACTION_TYPES.${name} ('${type}') has no enabled quest`).toBe(true);
    });
  });

  // A quest whose icon name isn't in QUEST_ICONS renders a generic Sparkles
  // and nobody notices until it's on a phone.
  it('every icon name resolves to a component', () => {
    Object.entries(QUEST_CATALOG).forEach(([id, q]) => {
      expect(QUEST_ICONS[q.icon], `${id} icon '${q.icon}' is not in QUEST_ICONS`).toBeTruthy();
    });
  });

  // Every quest must be reachable. `gym_checkin` was written and then cut
  // for exactly this: check-in is QR-only, so its row would have been
  // untappable.
  it('every quest has a destination route', () => {
    Object.keys(QUEST_CATALOG).forEach(id => {
      expect(questDestinationRoute(id), `${id} has no route`).toBeTruthy();
    });
  });

  it('has at least one enabled quest of each difficulty', () => {
    const enabled = Object.values(QUEST_CATALOG).filter(q => q.enabled);
    TIERS.forEach(diff => {
      expect(enabled.some(q => q.difficulty === diff), `no ${diff} quest enabled`).toBe(true);
    });
  });

  // The beta feedback this expansion answers was "quests have been
  // consistent the whole time" — with a pool of five, a uniform picker
  // repeats inside a week about as often as not. Pool size IS the fix, so
  // it's worth a floor rather than a comment.
  it('each tier has a pool deep enough to not repeat weekly', () => {
    const enabled = Object.values(QUEST_CATALOG).filter(q => q.enabled);
    ['easy', 'medium', 'hard'].forEach(diff => {
      const n = enabled.filter(q => q.difficulty === diff).length;
      expect(n, `${diff} pool is only ${n} deep`).toBeGreaterThanOrEqual(7);
    });
  });
});

describe('QUEST_DIFFICULTY rewards', () => {
  it('has positive coin rewards in ascending order', () => {
    expect(QUEST_DIFFICULTY.easy.coinReward).toBeGreaterThan(0);
    expect(QUEST_DIFFICULTY.medium.coinReward).toBeGreaterThan(QUEST_DIFFICULTY.easy.coinReward);
    expect(QUEST_DIFFICULTY.hard.coinReward).toBeGreaterThan(QUEST_DIFFICULTY.medium.coinReward);
  });

  it('has positive XP rewards in ascending order', () => {
    expect(QUEST_DIFFICULTY.easy.xpReward).toBeGreaterThan(0);
    expect(QUEST_DIFFICULTY.medium.xpReward).toBeGreaterThan(QUEST_DIFFICULTY.easy.xpReward);
    expect(QUEST_DIFFICULTY.hard.xpReward).toBeGreaterThan(QUEST_DIFFICULTY.medium.xpReward);
  });

  // MIRROR GUARD. Migration 316's two CASE blocks are authoritative — the
  // trigger overwrites whatever the client sends on INSERT. If these drift,
  // the server keeps paying the old rate and every UI number is a lie. This
  // is the test that fails when someone edits one and not the other.
  it('mirrors the server constants in migration 316', () => {
    expect(QUEST_DIFFICULTY.easy.coinReward).toBe(8);
    expect(QUEST_DIFFICULTY.medium.coinReward).toBe(20);
    expect(QUEST_DIFFICULTY.hard.coinReward).toBe(50);
    expect(QUEST_DIFFICULTY.crew.coinReward).toBe(25);

    expect(QUEST_DIFFICULTY.easy.xpReward).toBe(20);
    expect(QUEST_DIFFICULTY.medium.xpReward).toBe(50);
    expect(QUEST_DIFFICULTY.hard.xpReward).toBe(120);
    expect(QUEST_DIFFICULTY.crew.xpReward).toBe(60);

    expect(PERFECT_DAY_BONUS).toEqual({ coinReward: 30, xpReward: 100, crewXp: 50 });
  });

  // A maximal quest day must stay inside grant_action_xp's 'daily_quest'
  // cap of 400, or the last claim of the day silently credits nothing while
  // the toast still says it paid.
  it('a maximal day fits inside the server daily_quest XP cap', () => {
    const maxDay = TIERS.reduce((sum, t) => sum + QUEST_DIFFICULTY[t].xpReward, 0);
    expect(maxDay).toBeLessThanOrEqual(400);
  });

  it('a crew quest passes its full XP to the crew, others a quarter', () => {
    expect(QUEST_DIFFICULTY.crew.crewXpShare).toBe(1);
    ['easy', 'medium', 'hard'].forEach(t => {
      expect(QUEST_DIFFICULTY[t].crewXpShare).toBe(0.25);
    });
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

  it('adds a fourth crew quest only when the user is in a crew', () => {
    const solo = pickDailyQuests(userId, '2026-01-15', false);
    const crewed = pickDailyQuests(userId, '2026-01-15', true);
    expect(solo).toHaveLength(3);
    expect(crewed).toHaveLength(4);
    expect(crewed.filter(q => q.difficulty === 'crew')).toHaveLength(1);
    // The other three must be identical — joining a crew ADDS a quest, it
    // doesn't reroll the day and take away progress already made.
    expect(crewed.slice(0, 3).map(q => q.id)).toEqual(solo.map(q => q.id));
  });

  it('is deterministic — same inputs always return the same set', () => {
    const a = pickDailyQuests(userId, '2026-01-15', true);
    const b = pickDailyQuests(userId, '2026-01-15', true);
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

  // The actual complaint, measured rather than asserted qualitatively:
  // across four weeks, no single quest should own a tier. With the old
  // pool of five this test would have been a coin flip.
  it('does not repeat one quest for a whole tier across four weeks', () => {
    ['easy', 'medium', 'hard'].forEach(diff => {
      const seen = new Set();
      for (let d = 0; d < 28; d++) {
        const date = new Date(Date.UTC(2026, 0, 1 + d)).toISOString().slice(0, 10);
        const pick = pickDailyQuests(userId, date).find(q => q.difficulty === diff);
        seen.add(pick.id);
      }
      expect(seen.size, `${diff} only surfaced ${seen.size} distinct quests in 28 days`)
        .toBeGreaterThanOrEqual(4);
    });
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

describe('difficultyRank', () => {
  // Sorting by the raw string puts 'crew' between 'cardio' and 'easy' —
  // i.e. FIRST, ahead of the easy quest. That's what the DB's
  // `order by difficulty` did, and why the ordering moved into JS.
  it('orders easy → medium → hard → crew', () => {
    const sorted = ['crew', 'hard', 'easy', 'medium']
      .sort((a, b) => difficultyRank(a) - difficultyRank(b));
    expect(sorted).toEqual(DIFFICULTY_ORDER);
  });

  it('sorts an unknown difficulty last rather than producing NaN', () => {
    expect(difficultyRank('mythic')).toBeGreaterThan(difficultyRank('crew'));
    expect(Number.isFinite(difficultyRank('mythic'))).toBe(true);
  });
});

describe('getQuestDefinition', () => {
  it('returns the full def with coinReward derived from difficulty', () => {
    const def = getQuestDefinition('log_meal');
    expect(def).toBeTruthy();
    expect(def.id).toBe('log_meal');
    expect(def.coinReward).toBe(QUEST_DIFFICULTY.easy.coinReward);
    expect(def.xpReward).toBe(QUEST_DIFFICULTY.easy.xpReward);
  });

  // Math.ceil, matching the CEIL() in claim_quest_atomic. A quarter of 20 is
  // 5 either way; a quarter of 50 is 12.5, and the two sides must round the
  // same direction or the toast promises XP the crew never banks.
  it('rounds the crew share up, the way the SQL does', () => {
    expect(getQuestDefinition('log_meal').crewXpReward).toBe(5);        // ceil(20 * .25)
    expect(getQuestDefinition('workout_complete').crewXpReward).toBe(13); // ceil(50 * .25)
    expect(getQuestDefinition('hit_pr').crewXpReward).toBe(30);         // ceil(120 * .25)
  });

  it('passes the full XP through for a crew quest', () => {
    const def = getQuestDefinition('crew_workout');
    expect(def.crewXpReward).toBe(def.xpReward);
  });

  it('returns null for unknown quest ids', () => {
    expect(getQuestDefinition('nonexistent_quest')).toBeNull();
  });
});
