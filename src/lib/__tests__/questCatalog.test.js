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

  it('different users produce independent selections', () => {
    const a = pickDailyQuests('user-1', '2026-01-15');
    const b = pickDailyQuests('user-2', '2026-01-15');
    // Possible they pick the same quests by coincidence — but at least they
    // both succeed and produce valid sets.
    expect(a).toHaveLength(3);
    expect(b).toHaveLength(3);
  });
});

// ── Rotation quality ────────────────────────────────────────────────────────
//
// This block exists because the assertion it replaced — "each tier surfaces at
// least 4 distinct quests in 28 days" — passed comfortably while the real
// behaviour was 23.9% next-day repeats and a same-task pair on a quarter of
// all days. A qualitative assertion cannot catch a distribution problem. So
// this simulates the picker and measures it, the same way the one-off script
// that found the defect did.
//
// The thresholds sit just above the measured figures. They are a ratchet: if a
// catalog edit or a picker change pushes a rate up, this fails and names the
// number, rather than the regression reaching a user as "my quests are always
// the same".
describe('pickDailyQuests — rotation quality (simulated)', () => {
  const USERS = 40, DAYS = 200;
  const D0 = Date.UTC(2026, 0, 1);
  const dstr = (i) => new Date(D0 + i * 86400000).toISOString().slice(0, 10);

  // Run once; every assertion below reads these.
  const stat = {
    picks: 0, next: 0, within3: 0,
    perTier: {}, familyClashDays: 0, days: 0,
  };
  for (const t of ['easy', 'medium', 'hard', 'crew']) {
    stat.perTier[t] = { picks: 0, next: 0, within3: 0 };
  }
  for (let u = 0; u < USERS; u++) {
    const last = {};
    for (let i = 0; i < DAYS; i++) {
      const set = pickDailyQuests(`sim-user-${u}`, dstr(i), true);
      stat.days++;

      // The crew quest is exempt on purpose (FAMILY_EXEMPT) — its overlap
      // with a lifting or cardio quest is the tier's whole pitch, so it is
      // excluded from the clash check rather than silently inflating it.
      const solo = set.filter(q => q.difficulty !== 'crew').map(q => q.family);
      if (solo.length !== new Set(solo).size) stat.familyClashDays++;

      for (const q of set) {
        stat.picks++;
        const s = stat.perTier[q.difficulty];
        s.picks++;
        if (last[q.id] !== undefined) {
          const gap = i - last[q.id];
          if (gap === 1) { stat.next++; s.next++; }
          if (gap <= 3) { stat.within3++; s.within3++; }
        }
        last[q.id] = i;
      }
    }
  }
  const rate = (n, d) => (100 * n) / d;

  it('never gives two quests that complete each other on the same day', () => {
    // Not a rate — zero. "Drink 4 glasses" beside "Drink 8 glasses" pays
    // twice for one act, and this was true on 25.1% of days before families
    // existed.
    expect(stat.familyClashDays, `${stat.familyClashDays} of ${stat.days} days had a same-family pair`)
      .toBe(0);
  });

  it('repeats a quest the very next day under 3% of the time', () => {
    const r = rate(stat.next, stat.picks);
    expect(r, `next-day repeat rate is ${r.toFixed(2)}% (was 23.85% before the rotation)`)
      .toBeLessThan(3);
  });

  it('repeats a quest within three days under 8% of the time', () => {
    const r = rate(stat.within3, stat.picks);
    expect(r, `within-3-day repeat rate is ${r.toFixed(2)}% (was 48.00%)`).toBeLessThan(8);
  });

  // `hard` resolves first, so it is never displaced by a family clash and
  // rides its rotation untouched. It measures exactly zero, so it is asserted
  // exactly: any consecutive repeat there means the rotation itself broke,
  // which is a different and worse bug than displacement drift.
  it('never repeats a hard quest on consecutive days', () => {
    expect(stat.perTier.hard.next).toBe(0);
  });

  // THE ONE THAT MATTERS, and the one whose absence let a real regression
  // through. A previous version handed short pools a single fixed permutation
  // cycled forever. It scored a flawless 0.00% on both rates above — and gave
  // every user the same six crew quests in the same order until they quit.
  // Repeat rate cannot see that; this can.
  //
  // A user cannot perceive a percentage. They can perceive "Tuesday is always
  // the crew walk". So the rotation's real contract is that the ORDER keeps
  // changing, and that is what is asserted here.
  it('does not hand a tier the same running order twice', () => {
    for (const diff of ['easy', 'medium', 'hard', 'crew']) {
      const L = Object.values(QUEST_CATALOG)
        .filter(q => q.enabled && q.difficulty === diff).length;
      const orders = new Set();
      let cycles = 0;
      for (let u = 0; u < 12; u++) {
        const seq = [];
        for (let i = 0; i < L * 8; i++) {
          seq.push(pickDailyQuests(`order-u${u}`, dstr(i), true).find(q => q.difficulty === diff).id);
        }
        for (let s = 0; s + L <= seq.length; s += L) { orders.add(seq.slice(s, s + L).join('>')); cycles++; }
      }
      // Comfortably above the degenerate case, which is exactly `12` — one
      // fixed order per user, no matter how many cycles run.
      expect(orders.size, `${diff} produced only ${orders.size} distinct orders across ${cycles} cycles`)
        .toBeGreaterThan(cycles * 0.6);
    }
  });

  it('uses every quest in a tier, not just a favoured few', () => {
    ['easy', 'medium', 'hard'].forEach(diff => {
      const pool = Object.entries(QUEST_CATALOG)
        .filter(([, q]) => q.enabled && q.difficulty === diff).map(([id]) => id);
      const seen = new Set();
      for (let i = 0; i < 120; i++) {
        seen.add(pickDailyQuests('coverage-user', dstr(i)).find(q => q.difficulty === diff).id);
      }
      expect(seen.size, `${diff} surfaced ${seen.size} of ${pool.length} quests in 120 days`)
        .toBe(pool.length);
    });
  });
});

describe('QUEST_CATALOG families', () => {
  it('every quest declares a family', () => {
    Object.entries(QUEST_CATALOG).forEach(([id, q]) => {
      expect(typeof q.family, `${id} has no family`).toBe('string');
      expect(q.family.length).toBeGreaterThan(0);
    });
  });

  // A family is only meaningful if more than one quest is in it — a family of
  // one constrains nothing and is usually a typo (`liftng`, `cardo`).
  it('has no family with only a single quest, which would be a typo', () => {
    const counts = {};
    Object.values(QUEST_CATALOG).forEach(q => { counts[q.family] = (counts[q.family] || 0) + 1; });
    const singles = Object.entries(counts).filter(([, n]) => n === 1).map(([f]) => f);
    // These four are genuinely one-of-a-kind actions, not typos. 'fuel' is
    // the crew-only gift action; the other three are single-shot milestones.
    expect(singles.sort()).toEqual(['fuel', 'goals', 'photo', 'pr']);
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
