// Unit tests for the quest PROGRESS path in quests.js — recordActions,
// recordAction and ensureTodaysQuests.
//
// These live apart from quests.test.js because they need a chainable
// supabase mock that records the SEQUENCE of statements, where the claim
// tests only need `rpc`. The sequence is the part that's actually
// unproven here: recordActions' whole reason to exist is that it reads the
// day's quests ONCE for a batch of actions, and nothing about the returned
// data would tell you if it silently went back to one read per action.
//
// The shape of the mock follows equipment.test.js — see the note in
// CLAUDE.md's Testing section about asserting on statement sequence.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const _db = {
  rows: [],          // user_daily_quests rows for "today"
  selects: 0,        // how many times the table was read
  updates: [],       // [{ id, patch }]
  crewRows: [],      // crew_members rows
  crewSelects: 0,
  insertedRows: null,
  failIds: new Set(), // row ids whose update the "database" refuses
};

function chainable(table) {
  if (table === 'crew_members') {
    const q = {
      select: () => q,
      eq: () => q,
      limit: async () => {
        _db.crewSelects += 1;
        return { data: _db.crewRows, error: null };
      },
    };
    return q;
  }

  // user_daily_quests. `.select().eq().eq()` resolves as a thenable so the
  // real code's `await supabase.from(...).select(...).eq(...).eq(...)`
  // works without the mock knowing how many eq() calls to expect.
  let pendingUpdate = null;
  const q = {
    select: () => q,
    insert: (rows) => {
      _db.insertedRows = rows;
      return {
        select: async () => {
          const stamped = rows.map((r, i) => ({
            ...r, id: `new-${i}`, completed_at: null, claimed_at: null,
          }));
          _db.rows = [..._db.rows, ...stamped];
          return { data: stamped, error: null };
        },
      };
    },
    update: (patch) => { pendingUpdate = patch; return q; },
    eq: (col, val) => {
      if (pendingUpdate && col === 'id') {
        const patch = pendingUpdate;
        pendingUpdate = null;
        if (_db.failIds.has(val)) {
          return Promise.resolve({ error: { code: '42501', message: 'refused' } });
        }
        const target = _db.rows.find(r => r.id === val);
        if (target) Object.assign(target, patch);
        _db.updates.push({ id: val, patch });
        return Promise.resolve({ error: null });
      }
      return q;
    },
    then: (resolve) => {
      _db.selects += 1;
      return Promise.resolve({ data: _db.rows, error: null }).then(resolve);
    },
  };
  return q;
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: (table) => chainable(table), rpc: async () => ({ data: null, error: null }) },
}));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const { recordActions, recordAction, ensureTodaysQuests, listTodaysQuests, todayDateString } =
  await import('../quests');
const { ACTION_TYPES } = await import('@/lib/questCatalog');
const { subscribeQuestCompleted, _resetQuestCompletion } = await import('@/lib/questCompletion');

const user = { id: 'uid', email: 'u@e.com' };

/** A stored quest row, the way the DB would hold it. */
function row(id, questId, difficulty, progress, target) {
  return {
    id, quest_id: questId, difficulty, progress, target,
    quest_date: todayDateString(), completed_at: null, claimed_at: null,
    coin_reward: 8, xp_reward: 20,
  };
}

beforeEach(() => {
  _db.rows = [];
  _db.selects = 0;
  _db.updates = [];
  _db.crewRows = [];
  _db.crewSelects = 0;
  _db.insertedRows = null;
  _db.failIds = new Set();
  _resetQuestCompletion();
});

describe('recordActions — batching', () => {
  it('reads the day once for a batch of four actions', async () => {
    _db.rows = [
      row('a', 'workout_15min',    'easy',   0, 15),
      row('b', 'workout_complete', 'medium', 0, 1),
      row('c', 'sets_40',          'hard',   0, 40),
    ];
    await recordActions(user, [
      { type: ACTION_TYPES.WORKOUT_COMPLETED, amount: 1 },
      { type: ACTION_TYPES.WORKOUT_MINUTES,   amount: 50 },
      { type: ACTION_TYPES.SETS_COMPLETED,    amount: 42 },
      { type: ACTION_TYPES.WORKOUT_VOLUME,    amount: 12000 },
    ]);
    // ONE read. The old shape was one recordAction call per action, each
    // doing its own full read — four round-trips to do one thing.
    expect(_db.selects).toBe(1);
    expect(_db.updates).toHaveLength(3);
  });

  it('clamps progress at target and stamps completed_at', async () => {
    _db.rows = [row('a', 'workout_15min', 'easy', 0, 15)];
    await recordActions(user, [{ type: ACTION_TYPES.WORKOUT_MINUTES, amount: 50 }]);
    expect(_db.updates[0].patch.progress).toBe(15);
    expect(_db.updates[0].patch.completed_at).toBeTruthy();
  });

  it('does not stamp completed_at when the quest is still short', async () => {
    _db.rows = [row('a', 'steps_10k', 'medium', 0, 10000)];
    await recordActions(user, [{ type: ACTION_TYPES.STEPS_LOGGED, amount: 4000 }]);
    expect(_db.updates[0].patch.progress).toBe(4000);
    expect(_db.updates[0].patch.completed_at).toBeUndefined();
  });

  it('collapses duplicate action types into one delta', async () => {
    _db.rows = [row('a', 'drink_water_8', 'medium', 0, 8)];
    await recordActions(user, [
      { type: ACTION_TYPES.WATER_LOGGED, amount: 3 },
      { type: ACTION_TYPES.WATER_LOGGED, amount: 2 },
    ]);
    expect(_db.updates).toHaveLength(1);
    expect(_db.updates[0].patch.progress).toBe(5);
  });

  // Callers pass `{ type, amount: durationMin }` unconditionally now rather
  // than building a filtered array, so dropping the empties is this
  // function's job.
  it('drops zero, negative, NaN and malformed entries without a round trip', async () => {
    _db.rows = [row('a', 'workout_15min', 'easy', 0, 15)];
    await recordActions(user, [
      { type: ACTION_TYPES.WORKOUT_MINUTES, amount: 0 },
      { type: ACTION_TYPES.WORKOUT_MINUTES, amount: -5 },
      { type: ACTION_TYPES.WORKOUT_MINUTES, amount: NaN },
      { type: null, amount: 10 },
      null,
    ]);
    expect(_db.selects).toBe(0);
    expect(_db.updates).toHaveLength(0);
  });

  // The idempotence every "log X" call site relies on: sleep, mood and body
  // metrics all fire on every save, including edits.
  it('skips a quest already at target, so a repeated log cannot double-count', async () => {
    _db.rows = [row('a', 'log_sleep', 'easy', 1, 1)];
    await recordActions(user, [{ type: ACTION_TYPES.SLEEP_LOGGED, amount: 1 }]);
    expect(_db.updates).toHaveLength(0);
  });

  it('ignores rows whose quest_id is not in the catalog', async () => {
    _db.rows = [row('a', 'quest_from_the_future', 'easy', 0, 5)];
    await recordActions(user, [{ type: ACTION_TYPES.MEAL_LOGGED, amount: 1 }]);
    expect(_db.updates).toHaveLength(0);
  });

  it('no-ops without a user', async () => {
    await recordActions(null, [{ type: ACTION_TYPES.MEAL_LOGGED, amount: 1 }]);
    expect(_db.selects).toBe(0);
  });

  it('recordAction delegates to recordActions', async () => {
    _db.rows = [row('a', 'log_meal', 'easy', 0, 1)];
    await recordAction(user, ACTION_TYPES.MEAL_LOGGED, 1);
    expect(_db.updates).toHaveLength(1);
    expect(_db.updates[0].patch.progress).toBe(1);
  });
});

// The completion cue used to live in the Today card, so a quest finished on
// the Hub said nothing until the user went back to Today. recordActions is
// the one writer of completed_at, so it is where the app learns of it.
describe('recordActions — announces completions app-wide', () => {
  const listen = () => {
    const heard = [];
    subscribeQuestCompleted((r) => heard.push(r));
    return heard;
  };

  it('announces the quest this write completed, with its new state', async () => {
    const heard = listen();
    _db.rows = [row('a', 'log_meal', 'easy', 0, 1)];
    await recordAction(user, ACTION_TYPES.MEAL_LOGGED, 1);
    expect(heard).toHaveLength(1);
    expect(heard[0].id).toBe('a');
    expect(heard[0].completed_at).toBeTruthy();
    expect(heard[0].progress).toBe(1);
  });

  it('says nothing while the quest is still short', async () => {
    const heard = listen();
    _db.rows = [row('a', 'steps_10k', 'medium', 0, 10000)];
    await recordActions(user, [{ type: ACTION_TYPES.STEPS_LOGGED, amount: 4000 }]);
    expect(heard).toHaveLength(0);
  });

  it('does not announce a completion the database refused', async () => {
    const heard = listen();
    _db.rows = [row('a', 'log_meal', 'easy', 0, 1)];
    _db.failIds.add('a');
    await recordAction(user, ACTION_TYPES.MEAL_LOGGED, 1);
    expect(heard).toHaveLength(0);
  });

  it('announces a row once even if two racing writes both complete it', async () => {
    const heard = listen();
    // Two reactions on two cards in quick succession both read progress 2
    // of 3 and both write the completing update.
    _db.rows = [row('a', 'log_meal', 'easy', 0, 1)];
    await Promise.all([
      recordAction(user, ACTION_TYPES.MEAL_LOGGED, 1),
      recordAction(user, ACTION_TYPES.MEAL_LOGGED, 1),
    ]);
    expect(heard).toHaveLength(1);
  });
});

describe('ensureTodaysQuests — crew seeding', () => {
  // Every test here uses its OWN user id. The crew lookup is memoised per
  // user for five minutes (it runs inside a queryFn that refetches every
  // 90s, so answering it from the network every pass is pure waste), and
  // that memo is module state which outlives beforeEach. Sharing one id
  // across these cases would have the second test read the first's cached
  // answer — which is exactly what happened when they did.
  let n = 0;
  const freshUser = () => ({ id: `uid-${++n}`, email: 'u@e.com' });

  it('seeds three quests for a user with no crew', async () => {
    const got = await ensureTodaysQuests(freshUser());
    expect(got).toHaveLength(3);
    expect(_db.insertedRows.map(r => r.difficulty).sort())
      .toEqual(['easy', 'hard', 'medium']);
  });

  it('seeds a fourth crew quest for a crew member', async () => {
    _db.crewRows = [{ crew_id: 'crew-1' }];
    const got = await ensureTodaysQuests(freshUser());
    expect(got).toHaveLength(4);
    expect(_db.insertedRows.some(r => r.difficulty === 'crew')).toBe(true);
  });

  it('is a no-op when the day is already fully seeded', async () => {
    _db.rows = [
      row('a', 'log_meal',         'easy',   0, 1),
      row('b', 'workout_complete', 'medium', 0, 1),
      row('c', 'hit_pr',           'hard',   0, 1),
    ];
    const got = await ensureTodaysQuests(freshUser());
    expect(got).toHaveLength(3);
    expect(_db.insertedRows).toBeNull();
  });

  // Joining a crew mid-day must ADD the crew quest, not reroll the day —
  // the other three keep whatever progress is already on them.
  it('backfills only the crew quest for someone who joined a crew today', async () => {
    _db.rows = [
      row('a', 'log_meal',         'easy',   1, 1),
      row('b', 'workout_complete', 'medium', 0, 1),
      row('c', 'hit_pr',           'hard',   0, 1),
    ];
    _db.crewRows = [{ crew_id: 'crew-1' }];
    const got = await ensureTodaysQuests(freshUser());
    expect(_db.insertedRows).toHaveLength(1);
    expect(_db.insertedRows[0].difficulty).toBe('crew');
    expect(got).toHaveLength(4);
    // The easy quest's existing progress survives.
    expect(got.find(r => r.id === 'a').progress).toBe(1);
  });

  it('sends both reward columns so the guard trigger has a complete row', async () => {
    await ensureTodaysQuests(freshUser());
    _db.insertedRows.forEach(r => {
      expect(r.coin_reward).toBeGreaterThan(0);
      expect(r.xp_reward).toBeGreaterThan(0);
    });
  });

  // The memo itself. Without it this lookup runs on every one of the card's
  // 90-second refetches, forever, to answer a question that changes when
  // somebody joins a crew.
  it('memoises the crew lookup across repeated calls for one user', async () => {
    const u = freshUser();
    await ensureTodaysQuests(u);
    const after = _db.crewSelects;
    _db.rows = [];
    await ensureTodaysQuests(u);
    await ensureTodaysQuests(u);
    expect(_db.crewSelects).toBe(after);
  });

  it('does not memoise a FAILED lookup', async () => {
    // A blip must not lock the answer to "no crew" for five minutes. The
    // mock returns an error by throwing from limit(), which hasCrew catches.
    const u = freshUser();
    const orig = _db.crewRows;
    Object.defineProperty(_db, 'crewRows', {
      configurable: true,
      get() { throw new Error('network'); },
    });
    await ensureTodaysQuests(u);
    delete _db.crewRows;
    _db.crewRows = [{ crew_id: 'crew-1' }, ...orig];
    _db.rows = [];
    const before = _db.crewSelects;
    await ensureTodaysQuests(u);
    expect(_db.crewSelects).toBeGreaterThan(before);
  });
});

describe('listTodaysQuests — ordering', () => {
  // The DB's `order by difficulty` sorted LEXICALLY, which puts 'crew'
  // between 'cardio' and 'easy' — i.e. first, ahead of the easy quest.
  // Ordering moved into JS for exactly this.
  it('orders easy → medium → hard → crew, not alphabetically', async () => {
    _db.rows = [
      row('c', 'hit_pr',           'hard',   0, 1),
      row('x', 'crew_workout',     'crew',   0, 1),
      row('a', 'log_meal',         'easy',   0, 1),
      row('b', 'workout_complete', 'medium', 0, 1),
    ];
    const got = await listTodaysQuests(user);
    expect(got.map(r => r.difficulty)).toEqual(['easy', 'medium', 'hard', 'crew']);
  });
});
