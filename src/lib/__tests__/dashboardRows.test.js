import { describe, it, expect } from 'vitest';
import { buildDashboardRows, reorderFrozen, flattenRows } from '../dashboardRows';

/* Kegan, dragging a dashboard section on a phone: "it pushes other items off
 * the screen and glitches the card I originally selected."
 *
 * The cause is in this file's first test. Rows are COMPOSED from the order —
 * two adjacent half-width sections merge into one row — so reordering does
 * not merely move rows, it creates and destroys them. Drag one section past
 * a pair and the pair splits into two rows and then re-merges, so the list
 * framer is animating changes MEMBERSHIP mid-gesture. Layout projection then
 * runs across two different lists and leaves rows holding deltas they never
 * resolve, and if the row under the pointer is the one that merges, its React
 * key changes and the element is unmounted out from under the drag.
 *
 * The gesture itself needs a real browser to judge. This property does not,
 * and it is the part that was actually wrong.
 */

const LAYOUTS = {
  week: 'half', muscles: 'half', streak: 'half', quote: 'half',
  actions: 'full', discover: 'full',
};
const keys = (order) => buildDashboardRows(order, LAYOUTS).map((r) => r.rowKey);

describe('buildDashboardRows — pairing is a function of ORDER, which is the trap', () => {
  it('merges adjacent halves and leaves everything else alone', () => {
    expect(keys(['week', 'muscles', 'actions', 'streak', 'quote', 'discover']))
      .toEqual(['week+muscles', 'actions', 'streak+quote', 'discover']);
  });

  it('degrades a lone half to its own full-width row rather than an orphan', () => {
    expect(keys(['week', 'actions', 'muscles'])).toEqual(['week', 'actions', 'muscles']);
  });

  it('treats an unset layout as full', () => {
    expect(buildDashboardRows(['a', 'b'], {}).map((r) => r.rowKey)).toEqual(['a', 'b']);
  });

  it('pairs greedily from the left, so three halves are a pair plus a single', () => {
    expect(keys(['week', 'muscles', 'streak'])).toEqual(['week+muscles', 'streak']);
  });

  // THE BUG. One drag crossing splits a pair; the next re-merges it.
  it('changes row COUNT and IDENTITY as a dragged section crosses a pair', () => {
    const atRest = ['week', 'muscles', 'actions', 'streak', 'quote', 'discover'];
    const oneCrossing = ['week', 'muscles', 'streak', 'actions', 'quote', 'discover'];
    const twoCrossings = ['week', 'muscles', 'streak', 'quote', 'actions', 'discover'];

    expect(keys(atRest)).toHaveLength(4);
    // 'streak+quote' is gone and two rows that never existed have appeared,
    // in the middle of a gesture, while framer is projecting layout.
    expect(keys(oneCrossing)).toEqual(['week+muscles', 'streak', 'actions', 'quote', 'discover']);
    expect(keys(oneCrossing)).toHaveLength(5);
    // …and then it comes back.
    expect(keys(twoCrossings)).toEqual(['week+muscles', 'streak+quote', 'actions', 'discover']);
    expect(keys(twoCrossings)).toHaveLength(4);
  });
});

describe('reorderFrozen — the same units, in a new order, and nothing else', () => {
  const frozen = buildDashboardRows(
    ['week', 'muscles', 'actions', 'streak', 'quote', 'discover'], LAYOUTS,
  );

  it('keeps every row identity across the move that used to split a pair', () => {
    const moved = reorderFrozen(frozen, ['week+muscles', 'streak+quote', 'actions', 'discover']);
    expect(moved.map((r) => r.rowKey))
      .toEqual(['week+muscles', 'streak+quote', 'actions', 'discover']);
    // Same count going in as coming out — the property the drag depends on.
    expect(moved).toHaveLength(frozen.length);
  });

  it('passes units through by reference, so React and framer keep the element', () => {
    const moved = reorderFrozen(frozen, ['actions', 'week+muscles', 'streak+quote', 'discover']);
    expect(moved[0]).toBe(frozen.find((r) => r.rowKey === 'actions'));
    expect(moved[1]).toBe(frozen.find((r) => r.rowKey === 'week+muscles'));
  });

  it('ignores keys it does not know, so a late callback cannot invent a row', () => {
    const moved = reorderFrozen(frozen, ['actions', 'ghost', 'week+muscles']);
    expect(moved.map((r) => r.rowKey)).toEqual(['actions', 'week+muscles']);
  });
});

describe('flattenRows — persisting the order without losing what is hidden', () => {
  it('flattens pairs back into their sections, in row order', () => {
    const rows = buildDashboardRows(['week', 'muscles', 'actions'], LAYOUTS);
    expect(flattenRows(rows)).toEqual(['week', 'muscles', 'actions']);
  });

  it('carries sections the row list never represented', () => {
    // Hidden sections and 'readiness' are filtered out before pairing. They
    // used to be dropped on every reorder, so hiding a section and then
    // dragging anything erased its saved slot.
    const rows = buildDashboardRows(['week', 'muscles'], LAYOUTS);
    expect(flattenRows(rows, ['hiddenOne', 'readiness']))
      .toEqual(['week', 'muscles', 'hiddenOne', 'readiness']);
  });

  it('round-trips a frozen reorder back into a section order', () => {
    const frozen = buildDashboardRows(['week', 'muscles', 'actions', 'streak', 'quote'], LAYOUTS);
    const moved = reorderFrozen(frozen, ['actions', 'week+muscles', 'streak+quote']);
    expect(flattenRows(moved)).toEqual(['actions', 'week', 'muscles', 'streak', 'quote']);
    // And re-pairing that committed order reproduces the rows the user sees.
    expect(keys(flattenRows(moved))).toEqual(['actions', 'week+muscles', 'streak+quote']);
  });
});
