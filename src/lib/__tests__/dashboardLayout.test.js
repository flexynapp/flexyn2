import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const updateMe = vi.fn(() => Promise.resolve());
vi.mock('@/api/db', () => ({ db: { auth: { updateMe: (...a) => updateMe(...a) } } }));

const {
  packLayout, unpackLayout, writeLayoutToLocal, clearLayoutLocal,
  queueLayoutSync, flushLayoutSync,
  HIDDEN_KEY, ORDER_KEY, LAYOUTS_KEY,
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
    expect(out).toEqual({ v: 1, hiddenSections: [], widgetOrder: [], sectionLayouts: {} });
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

  // The timer is module-level, so a pending write must not land after an
  // account switch and store the previous user's layout on the new session.
  it('flush cancels a pending write', () => {
    queueLayoutSync('u1', packLayout({ hiddenSections: ['a'] }));
    flushLayoutSync();
    vi.advanceTimersByTime(700);
    expect(updateMe).not.toHaveBeenCalled();
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
