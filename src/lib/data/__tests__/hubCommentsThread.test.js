/**
 * `buildThread` — grouping a flat comment list into threads.
 *
 * The bug this fixes is the worst kind: it lost data and never said so.
 *
 * The old implementation keyed `repliesByParent` by `parent_comment_id` and
 * the renderer only ever looked up TOP-LEVEL ids. So a reply to a reply keyed
 * itself under the reply, nothing asked for that key, and the comment simply
 * never rendered. It saved to the database correctly, returned a 200, and
 * disappeared. No error, no empty state, no warning — the author watched it
 * post and then could never find it again.
 *
 * That is why `drops nothing` below is the load-bearing test: the invariant is
 * that EVERY comment handed in comes back out somewhere, at any depth. A
 * renderer can choose how to display a thread; it may never silently swallow
 * one.
 */
import { describe, it, expect } from 'vitest';
import { buildThread } from '@/lib/data/hubComments';

let clock = 0;
const c = (id, parent = null, extra = {}) => ({
  id,
  parent_comment_id: parent,
  user_id: `u-${id}`,
  author_name: id,
  body: `body ${id}`,
  created_date: new Date(Date.UTC(2026, 7, 11, 0, 0, clock++)).toISOString(),
  ...extra,
});

const idsOf = (arr) => (arr || []).map(x => x.id);

describe('buildThread — the flat cases that already worked', () => {
  it('returns top-level comments in order', () => {
    const { topLevel, repliesByParent } = buildThread([c('a'), c('b')]);
    expect(idsOf(topLevel)).toEqual(['a', 'b']);
    expect(repliesByParent.size).toBe(0);
  });

  it('groups direct replies under their parent', () => {
    const { topLevel, repliesByParent } = buildThread([c('a'), c('a1', 'a'), c('a2', 'a')]);
    expect(idsOf(topLevel)).toEqual(['a']);
    expect(idsOf(repliesByParent.get('a'))).toEqual(['a1', 'a2']);
  });

  it('promotes an orphan whose parent is gone, flagged', () => {
    const { topLevel } = buildThread([c('x', 'deleted-parent')]);
    expect(idsOf(topLevel)).toEqual(['x']);
    expect(topLevel[0]._orphan).toBe(true);
  });
});

describe('buildThread — replies to replies', () => {
  it('surfaces a second-level reply instead of dropping it', () => {
    // THE regression. Before the fix this returned ['a1'] and 'a1a' vanished.
    const { repliesByParent } = buildThread([c('a'), c('a1', 'a'), c('a1a', 'a1')]);
    expect(idsOf(repliesByParent.get('a'))).toEqual(['a1', 'a1a']);
  });

  it('flattens arbitrary depth into the root thread', () => {
    const { topLevel, repliesByParent } = buildThread([
      c('a'), c('a1', 'a'), c('a1a', 'a1'), c('a1a1', 'a1a'), c('a1a1a', 'a1a1'),
    ]);
    expect(idsOf(topLevel)).toEqual(['a']);
    expect(idsOf(repliesByParent.get('a'))).toEqual(['a1', 'a1a', 'a1a1', 'a1a1a']);
  });

  it('orders a flattened thread chronologically, not by tree walk', () => {
    // b1 is written BEFORE a deep answer to a1, so it must read first.
    const root = c('a');
    const a1 = c('a1', 'a');
    const b1 = c('b1', 'a');
    const a1a = c('a1a', 'a1');   // newest
    const { repliesByParent } = buildThread([root, a1, b1, a1a]);
    expect(idsOf(repliesByParent.get('a'))).toEqual(['a1', 'b1', 'a1a']);
  });

  it('drops nothing, at any depth', () => {
    const rows = [
      c('a'), c('b'),
      c('a1', 'a'), c('a2', 'a'), c('a1a', 'a1'), c('a1a1', 'a1a'),
      c('b1', 'b'), c('b1a', 'b1'),
      c('orphan', 'long-gone'),
    ];
    const { topLevel, repliesByParent } = buildThread(rows);
    const seen = new Set([
      ...idsOf(topLevel),
      ...[...repliesByParent.values()].flatMap(idsOf),
    ]);
    for (const row of rows) {
      expect(seen.has(row.id), `${row.id} was swallowed`).toBe(true);
    }
    expect(seen.size).toBe(rows.length);
  });
});

describe('buildThread — the "replying to" hint', () => {
  it('is null for a reply that answers the thread root', () => {
    const { repliesByParent } = buildThread([c('a'), c('a1', 'a')]);
    expect(repliesByParent.get('a')[0]._replyTo).toBe(null);
  });

  it('names the parent when a reply answers another reply', () => {
    const { repliesByParent } = buildThread([c('a'), c('a1', 'a'), c('a1a', 'a1')]);
    const nested = repliesByParent.get('a').find(r => r.id === 'a1a');
    expect(nested._replyTo).toEqual({ user_id: 'u-a1', author_name: 'a1' });
  });
});

describe('buildThread — malformed input', () => {
  it('does not hang on a parent cycle', () => {
    // A cycle would send a naive depth-first walk into an infinite loop and
    // lock the render thread. Losing the cyclic rows is acceptable; hanging
    // the tab is not.
    const rows = [c('a'), c('x', 'y'), c('y', 'x')];
    const { topLevel, repliesByParent } = buildThread(rows);
    expect(idsOf(topLevel)).toEqual(['a']);
    expect(repliesByParent.get('a')).toBeUndefined();
  });

  it('does not hang when a comment is its own parent', () => {
    const rows = [c('a'), c('self', 'self')];
    const { topLevel } = buildThread(rows);
    expect(idsOf(topLevel)).toEqual(['a']);
  });

  it('handles an empty list', () => {
    const { topLevel, repliesByParent } = buildThread([]);
    expect(topLevel).toEqual([]);
    expect(repliesByParent.size).toBe(0);
  });
});
