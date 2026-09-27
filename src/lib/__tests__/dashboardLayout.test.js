import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const updateMe = vi.fn(() => Promise.resolve());
vi.mock('@/api/db', () => ({ db: { auth: { updateMe: (...a) => updateMe(...a) } } }));

const { setProfile, clearProfile } = await import('@/api/profileCache');

const {
  packLayout, unpackLayout, writeLayoutToLocal, clearLayoutLocal,
  queueLayoutSync, flushLayoutSync, mergeWidgetOrder,
  applyLayoutMigrations, readLocalDefaultsVersion, LAYOUT_DEFAULTS_VERSION, TODAY_RETIRED_SECTIONS,
  HIDDEN_KEY, ORDER_KEY, LAYOUTS_KEY, DEFAULTS_VERSION_KEY,
} = await import('../dashboardLayout');

beforeEach(() => {
  updateMe.mockClear();
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  flushLayoutSync();
  vi.useRealTimers();
});

describe('mergeWidgetOrder', () => {
  const DEFAULTS = ['stats', 'actions', 'recovery', 'challenges', 'progress', 'customize'];

  it('keeps the user ordering for sections that still exist', () => {
    const saved = ['progress', 'challenges', 'actions', 'recovery', 'stats', 'customize'];
    expect(mergeWidgetOrder(saved, DEFAULTS)).toEqual(saved);
  });

  it('drops ids we no longer render', () => {
    const saved = ['actions', 'readiness', 'friends', 'stats'];
    const out = mergeWidgetOrder(saved, DEFAULTS);
    expect(out).not.toContain('readiness');
    expect(out).not.toContain('friends');
  });

  // The regression this function exists for: 'stats' belongs directly under
  // the hero. Appending new ids put it at the very bottom for every user who
  // had ever opened edit mode.
  it('inserts a new section at its DEFAULT index, not at the end', () => {
    const saved = ['actions', 'recovery', 'challenges', 'progress', 'customize'];
    expect(mergeWidgetOrder(saved, DEFAULTS)[0]).toBe('stats');
  });

  it('keeps several new sections in their default order', () => {
    const out = mergeWidgetOrder(['challenges', 'customize'], DEFAULTS);
    // Each missing id lands at its own default index, so 'progress' (4)
    // slots in ahead of the 'customize' the user already had.
    expect(out).toEqual(['stats', 'actions', 'recovery', 'challenges', 'progress', 'customize']);
  });

  it('de-duplicates a corrupted saved order', () => {
    const out = mergeWidgetOrder(['actions', 'actions', 'stats'], DEFAULTS);
    expect(out.filter(id => id === 'actions')).toHaveLength(1);
  });

  it('falls back to the defaults for a non-array saved value', () => {
    expect(mergeWidgetOrder(null, DEFAULTS)).toEqual(DEFAULTS);
    expect(mergeWidgetOrder('nope', DEFAULTS)).toEqual(DEFAULTS);
  });

  it('returns every default exactly once, whatever the input', () => {
    const out = mergeWidgetOrder(['progress', 'zzz', 'progress'], DEFAULTS);
    expect([...out].sort()).toEqual([...DEFAULTS].sort());
  });
});

// v5 (the Today screen) hides sections on every layout it meets, so the
// pairing tests below look only at the steps they are about.
const pairingSteps = (applied) => applied.filter(name => name !== 'today-screen');

describe('applyLayoutMigrations', () => {
  // A layout saved before versioning: streak and challenges nowhere near
  // each other and neither one 'half' — i.e. the state every existing user
  // who had touched edit mode was stuck in.
  const legacy = () => ({
    hiddenSections: [],
    widgetOrder: ['streak', 'stats', 'actions', 'friends', 'challenges', 'journal'],
    sectionLayouts: { chest: 'half', league: 'half' },
  });

  // v2/v3 paired these two and v4 unpairs them again, so a run from 0 ends
  // full-width. The ORDER change from v2 stands: streak still lands beside
  // challenges, which is where the defaults put them either way — v4 only
  // takes back the halving.
  it('leaves streak and challenges full-width, adjacent, after the whole chain', () => {
    const { layout, version, applied } = applyLayoutMigrations(legacy(), 0);
    const i = layout.widgetOrder.indexOf('streak');
    expect(layout.widgetOrder[i + 1]).toBe('challenges');
    expect(layout.sectionLayouts.streak).toBe('full');
    expect(layout.sectionLayouts.challenges).toBe('full');
    expect(version).toBe(LAYOUT_DEFAULTS_VERSION);
    expect(applied).toContain('pair-streak-with-quests');
    expect(applied).toContain('unpair-streak-and-quests');
  });

  // The users this step exists for: already stamped v3, so v2/v3 never
  // re-run and the pairing is only reachable from here.
  it('unpairs a layout sitting on version 3', () => {
    const paired = {
      hiddenSections: [],
      widgetOrder: ['stats', 'streak', 'challenges', 'journal'],
      sectionLayouts: { streak: 'half', challenges: 'half', chest: 'half', league: 'half' },
    };
    const { layout, applied } = applyLayoutMigrations(paired, 3);
    expect(pairingSteps(applied)).toEqual(['unpair-streak-and-quests']);
    expect(layout.sectionLayouts.streak).toBe('full');
    expect(layout.sectionLayouts.challenges).toBe('full');
    // Someone else's pairing is not this step's business.
    expect(layout.sectionLayouts.chest).toBe('half');
    expect(layout.sectionLayouts.league).toBe('half');
    expect(layout.widgetOrder).toEqual(paired.widgetOrder);
  });

  it('reports no change when the sections are already full-width', () => {
    const unpaired = {
      hiddenSections: [],
      widgetOrder: ['streak', 'challenges'],
      sectionLayouts: { streak: 'full', challenges: 'full' },
    };
    const { applied } = applyLayoutMigrations(unpaired, 3);
    expect(pairingSteps(applied)).toEqual([]);
  });

  it('leaves every other section where the user put it', () => {
    const { layout } = applyLayoutMigrations(legacy(), 0);
    expect(layout.widgetOrder.filter(id => id !== 'streak'))
      .toEqual(['stats', 'actions', 'friends', 'challenges', 'journal']);
  });

  it('preserves unrelated pairings', () => {
    const { layout } = applyLayoutMigrations(legacy(), 0);
    expect(layout.sectionLayouts.chest).toBe('half');
    expect(layout.sectionLayouts.league).toBe('half');
  });

  it('adds and drops nothing', () => {
    const before = legacy();
    const { layout } = applyLayoutMigrations(before, 0);
    expect([...layout.widgetOrder].sort()).toEqual([...before.widgetOrder].sort());
  });

  // A hidden section must not be resurrected by a default change.
  it('declines to pair when either section is hidden', () => {
    const hidden = { ...legacy(), hiddenSections: ['challenges'] };
    const { layout, applied, version } = applyLayoutMigrations(hidden, 0);
    expect(pairingSteps(applied)).toEqual([]);
    expect(layout.widgetOrder).toEqual(hidden.widgetOrder);
    expect(layout.sectionLayouts.streak).toBeUndefined();
    // ...but the version still advances, or this retries on every load.
    expect(version).toBe(LAYOUT_DEFAULTS_VERSION);
  });

  it('is a no-op for a layout already on the current version', () => {
    const current = applyLayoutMigrations(legacy(), 0).layout;
    const again = applyLayoutMigrations(current, LAYOUT_DEFAULTS_VERSION);
    expect(again.applied).toEqual([]);
    expect(again.layout).toEqual(current);
  });

  // Idempotence is about the LAYOUT, and that still holds exactly. What no
  // longer holds is `applied` being empty on a re-run: v2 sees the pair
  // adjacent but no longer halved (v4 unhalved it) and re-halves, then v4
  // unhalves again. Same bytes out, so the caller's only cost is hydrating
  // state it already had — but the chain does churn, and a step added later
  // that ISN'T outcome-stable would show up here first.
  it('is idempotent when re-run from version 0', () => {
    const once = applyLayoutMigrations(legacy(), 0).layout;
    const twice = applyLayoutMigrations(once, 0);
    expect(twice.layout).toEqual(once);
  });

  it('skips a step whose sections are absent entirely', () => {
    const sparse = { hiddenSections: [], widgetOrder: ['stats', 'journal'], sectionLayouts: {} };
    const { layout, applied } = applyLayoutMigrations(sparse, 0);
    expect(pairingSteps(applied)).toEqual([]);
    expect(layout.widgetOrder).toEqual(['stats', 'journal']);
  });
});

describe('defaults version round trip', () => {
  it('treats a blob with no dv as version 0, not as current', () => {
    const unpacked = unpackLayout({ v: 1, hiddenSections: [], widgetOrder: ['stats'], sectionLayouts: {} });
    expect(unpacked.defaultsVersion).toBe(0);
  });

  it('packs and reads back the version it was given', () => {
    const packed = packLayout({ hiddenSections: [], widgetOrder: ['stats'], sectionLayouts: {}, defaultsVersion: 2 });
    expect(packed.dv).toBe(2);
    expect(unpackLayout(packed).defaultsVersion).toBe(2);
  });

  it('defaults to the current version when packing without one', () => {
    expect(packLayout({ hiddenSections: [], widgetOrder: [], sectionLayouts: {} }).dv)
      .toBe(LAYOUT_DEFAULTS_VERSION);
  });

  it('mirrors the version locally and reads it back', () => {
    writeLayoutToLocal('u1', { hiddenSections: [], widgetOrder: ['stats'], sectionLayouts: {}, defaultsVersion: 2 });
    expect(localStorage.getItem(DEFAULTS_VERSION_KEY('u1'))).toBe('2');
    expect(readLocalDefaultsVersion('u1')).toBe(2);
  });

  it('reports 0 when nothing has been mirrored yet', () => {
    expect(readLocalDefaultsVersion('never-seen')).toBe(0);
  });

  // Reset lands on the current defaults by definition, so the migration must
  // not run afterwards and reshuffle what Reset just set.
  it('marks the local mirror current after a Reset', () => {
    clearLayoutLocal('u2');
    expect(readLocalDefaultsVersion('u2')).toBe(LAYOUT_DEFAULTS_VERSION);
  });
});

describe('packLayout', () => {
  it('serialises a Set of hidden sections to an array', () => {
    const out = packLayout({
      hiddenSections: new Set(['friends', 'chest']),
      widgetOrder: ['league', 'quests'],
      sectionLayouts: { league: 'half' },
    });
    expect(out.hiddenSections).toEqual(['friends', 'chest']);
    expect(out.widgetOrder).toEqual(['league', 'quests']);
    expect(out.sectionLayouts).toEqual({ league: 'half' });
    expect(out.v).toBe(1);
  });

  it('tolerates missing pieces without throwing', () => {
    const out = packLayout({});
    // dv is the defaults version, separate from v (the blob shape). Packing
    // without one means "written by current code", so it stamps current.
    expect(out).toEqual({
      v: 1,
      dv: LAYOUT_DEFAULTS_VERSION,
      hiddenSections: [],
      widgetOrder: [],
      sectionLayouts: {},
    });
  });
});

describe('unpackLayout', () => {
  it('returns null for anything that is not a layout object', () => {
    for (const bad of [null, undefined, 'x', 42, [], ['a']]) {
      expect(unpackLayout(bad)).toBeNull();
    }
  });

  // The distinction that matters: "never customized" (null) must not be
  // confused with "customized to empty". A user who hid every section has
  // an explicit layout that has to survive onto their next device.
  it('treats an explicitly empty layout as a real layout, not as absent', () => {
    const out = unpackLayout({ v: 1, hiddenSections: [], widgetOrder: [], sectionLayouts: {} });
    expect(out).not.toBeNull();
    expect(out.hiddenSections).toEqual([]);
  });

  it('drops non-string entries rather than surfacing junk into render', () => {
    const out = unpackLayout({
      hiddenSections: ['friends', 3, null],
      widgetOrder: ['league', {}],
      sectionLayouts: { league: 'half' },
    });
    expect(out.hiddenSections).toEqual(['friends']);
    expect(out.widgetOrder).toEqual(['league']);
  });

  it('coerces a malformed sectionLayouts to an empty object', () => {
    expect(unpackLayout({ sectionLayouts: ['nope'] }).sectionLayouts).toEqual({});
    expect(unpackLayout({ sectionLayouts: 'nope' }).sectionLayouts).toEqual({});
  });
});

describe('local mirror', () => {
  it('writes all three keys Dashboard reads on mount', () => {
    writeLayoutToLocal('u1', { hiddenSections: ['friends'], widgetOrder: ['league'], sectionLayouts: { league: 'half' } });
    expect(JSON.parse(localStorage.getItem(HIDDEN_KEY('u1')))).toEqual(['friends']);
    expect(JSON.parse(localStorage.getItem(ORDER_KEY('u1')))).toEqual(['league']);
    expect(JSON.parse(localStorage.getItem(LAYOUTS_KEY('u1')))).toEqual({ league: 'half' });
  });

  // The old reset path removed widgetOrder and sectionLayouts but left
  // hidden sections hidden, with no other way to bring them all back.
  it('clears all three keys, including hidden sections', () => {
    writeLayoutToLocal('u1', { hiddenSections: ['friends'], widgetOrder: ['league'], sectionLayouts: {} });
    clearLayoutLocal('u1');
    expect(localStorage.getItem(HIDDEN_KEY('u1'))).toBeNull();
    expect(localStorage.getItem(ORDER_KEY('u1'))).toBeNull();
    expect(localStorage.getItem(LAYOUTS_KEY('u1'))).toBeNull();
  });
});

describe('queueLayoutSync', () => {
  it('collapses an edit burst into one write', () => {
    queueLayoutSync('u1', packLayout({ hiddenSections: ['a'] }));
    queueLayoutSync('u1', packLayout({ hiddenSections: ['a', 'b'] }));
    queueLayoutSync('u1', packLayout({ hiddenSections: ['a', 'b', 'c'] }));
    expect(updateMe).not.toHaveBeenCalled();
    vi.advanceTimersByTime(700);
    expect(updateMe).toHaveBeenCalledTimes(1);
    expect(updateMe.mock.calls[0][0].dashboard_layout.hiddenSections).toEqual(['a', 'b', 'c']);
  });

  it('does nothing without a user id', () => {
    queueLayoutSync(null, packLayout({}));
    vi.advanceTimersByTime(700);
    expect(updateMe).not.toHaveBeenCalled();
  });

  // Leaving Dashboard inside the debounce used to CANCEL the write, so the
  // last reorder never reached the account.
  it('flush sends a pending write immediately, once', () => {
    queueLayoutSync('u1', packLayout({ hiddenSections: ['a'] }));
    flushLayoutSync();
    expect(updateMe).toHaveBeenCalledTimes(1);
    expect(updateMe.mock.calls[0][0].dashboard_layout.hiddenSections).toEqual(['a']);
    vi.advanceTimersByTime(700);
    flushLayoutSync();
    expect(updateMe).toHaveBeenCalledTimes(1);
  });

  // The timer is module-level, so a pending write must not land after an
  // account switch and store the previous user's layout on the new session.
  it('drops a pending write when another account is signed in', () => {
    queueLayoutSync('u1', packLayout({ hiddenSections: ['a'] }));
    setProfile({ id: 'u2' });
    vi.advanceTimersByTime(700);
    queueLayoutSync('u1', packLayout({ hiddenSections: ['b'] }));
    flushLayoutSync();
    expect(updateMe).not.toHaveBeenCalled();
    clearProfile();
  });

  it('survives an updateMe rejection without escaping', async () => {
    updateMe.mockImplementationOnce(() => Promise.reject(new Error('42703')));
    queueLayoutSync('u1', packLayout({}));
    expect(() => vi.advanceTimersByTime(700)).not.toThrow();
    await Promise.resolve();
    expect(updateMe).toHaveBeenCalledTimes(1);
  });
});

describe('round trip', () => {
  it('pack → unpack preserves the layout', () => {
    const original = {
      hiddenSections: new Set(['friends', 'chest']),
      widgetOrder: ['league', 'quests', 'actions'],
      sectionLayouts: { league: 'half', readiness: 'half' },
    };
    const back = unpackLayout(packLayout(original));
    expect(back.hiddenSections).toEqual(['friends', 'chest']);
    expect(back.widgetOrder).toEqual(original.widgetOrder);
    expect(back.sectionLayouts).toEqual(original.sectionLayouts);
  });
});

describe('v5: the Today screen', () => {
  const v4 = () => ({
    hiddenSections: ['journal'],
    widgetOrder: ['stats', 'actions', 'recovery', 'streak', 'challenges', 'chest', 'league', 'journal'],
    sectionLayouts: { chest: 'half', league: 'half' },
  });

  it('hides every retired section and keeps what was already hidden', () => {
    const { layout, applied } = applyLayoutMigrations(v4(), 4);
    expect(applied).toEqual(['today-screen']);
    for (const id of TODAY_RETIRED_SECTIONS) expect(layout.hiddenSections).toContain(id);
    expect(layout.hiddenSections.filter(id => id === 'journal')).toHaveLength(1);
  });

  it('leaves the Today sections visible', () => {
    const { layout } = applyLayoutMigrations(v4(), 4);
    for (const id of ['recovery', 'streak', 'challenges']) expect(layout.hiddenSections).not.toContain(id);
  });

  it('touches neither the order nor the pairings, so a restore lands where it was', () => {
    const before = v4();
    const { layout } = applyLayoutMigrations(before, 4);
    expect(layout.widgetOrder).toEqual(before.widgetOrder);
    expect(layout.sectionLayouts).toEqual(before.sectionLayouts);
  });

  it('does not re-hide a section restored after it ran', () => {
    const migrated = applyLayoutMigrations(v4(), 4).layout;
    const restored = { ...migrated, hiddenSections: migrated.hiddenSections.filter(id => id !== 'stats') };
    const again = applyLayoutMigrations(restored, LAYOUT_DEFAULTS_VERSION);
    expect(again.applied).toEqual([]);
    expect(again.layout.hiddenSections).not.toContain('stats');
  });
});

