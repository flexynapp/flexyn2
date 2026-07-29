import { describe, it, expect } from 'vitest';
import { windowRanked } from '../LeaderboardsContent';

// Build a ranked list of N rows, ids 'u1'…'uN', ranks 1…N.
const makeRanked = (n) =>
  Array.from({ length: n }, (_, i) => ({ id: `u${i + 1}`, rank: i + 1 }));

const rowIds = (entries) =>
  entries.filter(e => e.type === 'row').map(e => e.row.id);

const ellipses = (entries) => entries.filter(e => e.type === 'ellipsis');

describe('windowRanked', () => {
  it('leaves a short list untouched — nothing to collapse', () => {
    const ranked = makeRanked(6);
    const out = windowRanked(ranked, 5);
    expect(rowIds(out)).toEqual(['u1', 'u2', 'u3', 'u4', 'u5', 'u6']);
    expect(ellipses(out)).toHaveLength(0);
  });

  it('shows podium, a gap, then the user and their neighbours', () => {
    const ranked = makeRanked(100);
    const out = windowRanked(ranked, 49); // user is rank 50

    // Podium is always pinned.
    expect(rowIds(out).slice(0, 3)).toEqual(['u1', 'u2', 'u3']);
    // The user plus three either side.
    expect(rowIds(out)).toContain('u50');
    for (const id of ['u47', 'u48', 'u49', 'u51', 'u52', 'u53']) {
      expect(rowIds(out)).toContain(id);
    }
    // Everything between the podium and the neighbourhood is folded away.
    expect(rowIds(out)).not.toContain('u25');
  });

  it('renders the user exactly once — the old flat list needed suppression logic', () => {
    const ranked = makeRanked(100);
    const out = windowRanked(ranked, 49);
    expect(rowIds(out).filter(id => id === 'u50')).toHaveLength(1);
  });

  it('collapses each hidden run into a single ellipsis carrying its count', () => {
    const ranked = makeRanked(100);
    const out = windowRanked(ranked, 49);
    const gaps = ellipses(out);
    // Two gaps: podium → neighbourhood, and neighbourhood → tail.
    expect(gaps).toHaveLength(2);
    // Ranks 4..46 hidden before the window.
    expect(gaps[0].count).toBe(43);
    // Ranks 54..100 hidden after it.
    expect(gaps[1].count).toBe(47);
    // Every row is accounted for: shown + hidden === total.
    const shown = rowIds(out).length;
    const hidden = gaps.reduce((s, g) => s + g.count, 0);
    expect(shown + hidden).toBe(100);
  });

  it('merges the podium into the window when the user ranks near the top', () => {
    const ranked = makeRanked(100);
    const out = windowRanked(ranked, 4); // user is rank 5
    // No gap between podium and neighbourhood — they overlap.
    expect(rowIds(out).slice(0, 8)).toEqual(
      ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7', 'u8']
    );
    expect(ellipses(out)).toHaveLength(1); // only the tail
  });

  it('does not run past the end of the list when the user is last', () => {
    const ranked = makeRanked(20);
    const out = windowRanked(ranked, 19); // user is rank 20
    expect(rowIds(out)).toContain('u20');
    expect(rowIds(out)).toContain('u17');
    expect(ellipses(out)).toHaveLength(1);
    // No trailing gap after the final row.
    expect(out[out.length - 1].type).toBe('row');
  });

  it('falls back to a deeper head when the user is not on the board', () => {
    const ranked = makeRanked(100);
    const out = windowRanked(ranked, -1);
    expect(rowIds(out)).toHaveLength(10);
    expect(rowIds(out)[0]).toBe('u1');
    expect(ellipses(out)[0].count).toBe(90);
  });

  it('handles an empty board', () => {
    expect(windowRanked([], -1)).toEqual([]);
  });
});
