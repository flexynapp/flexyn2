// Unit tests for hubComments helpers.
// Currently focused on `buildThread` since that's where the visible bug
// fix landed (orphan replies were being silently dropped).

import { describe, it, expect } from 'vitest';
import { buildThread } from '../data/hubComments';

const c = (id, body, parent = null) => ({
  id,
  body,
  parent_comment_id: parent,
  created_date: '2026-05-12T10:00:00Z',
  author_email: 'a@b.c',
});

describe('buildThread', () => {
  it('partitions top-level comments and replies', () => {
    const list = [
      c('1', 'top one'),
      c('2', 'top two'),
      c('3', 'reply to 1', '1'),
      c('4', 'another reply to 1', '1'),
      c('5', 'reply to 2', '2'),
    ];
    const { topLevel, repliesByParent } = buildThread(list);
    expect(topLevel.map(t => t.id)).toEqual(['1', '2']);
    expect(repliesByParent.get('1').map(r => r.id)).toEqual(['3', '4']);
    expect(repliesByParent.get('2').map(r => r.id)).toEqual(['5']);
  });

  it('promotes orphan replies (parent missing) to top-level instead of dropping', () => {
    // Comment "99" references a parent ID that doesn't exist in the list.
    // Previously this was silently skipped; now it should still appear.
    const list = [
      c('1', 'top one'),
      c('99', 'reply to a deleted comment', 'deleted-parent-id'),
    ];
    const { topLevel } = buildThread(list);
    expect(topLevel.length).toBe(2);
    expect(topLevel.find(t => t.id === '99')).toBeTruthy();
  });

  it('flags promoted orphans with _orphan = true', () => {
    const list = [c('99', 'orphan', 'missing-parent')];
    const { topLevel } = buildThread(list);
    expect(topLevel[0]._orphan).toBe(true);
  });

  it('does NOT flag genuine top-level comments as orphan', () => {
    const list = [c('1', 'top one'), c('2', 'top two')];
    const { topLevel } = buildThread(list);
    for (const t of topLevel) {
      expect(t._orphan).toBeUndefined();
    }
  });

  it('handles empty list', () => {
    const { topLevel, repliesByParent } = buildThread([]);
    expect(topLevel).toEqual([]);
    expect(repliesByParent.size).toBe(0);
  });

  it('replies whose parents come LATER in the list still attach', () => {
    // The current implementation builds byId upfront so order doesn't matter.
    const list = [
      c('reply', 'pre-emptive reply', 'parent'),
      c('parent', 'the parent'),
    ];
    const { topLevel, repliesByParent } = buildThread(list);
    expect(topLevel.map(t => t.id)).toEqual(['parent']);
    expect(repliesByParent.get('parent').map(r => r.id)).toEqual(['reply']);
  });
});
