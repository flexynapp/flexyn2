import { describe, it, expect } from 'vitest';
import {
  hasActiveStory,
  hasActiveNote,
  shouldShowStoryAvatar,
  filterVisibleStoryGroups,
  orderStoryGroups,
} from '@/lib/storiesRowVisibility';

const group = (over = {}) => ({
  user_id: 'u1',
  username: 'athlete',
  isOwn: false,
  stories: [],
  note: null,
  ...over,
});

describe('hasActiveStory', () => {
  it('is true only when the stories array has entries', () => {
    expect(hasActiveStory(group({ stories: [{ id: 's1' }] }))).toBe(true);
    expect(hasActiveStory(group({ stories: [] }))).toBe(false);
  });

  it('tolerates a missing or non-array stories field', () => {
    expect(hasActiveStory(group({ stories: undefined }))).toBe(false);
    expect(hasActiveStory(group({ stories: null }))).toBe(false);
    expect(hasActiveStory({})).toBe(false);
    expect(hasActiveStory(undefined)).toBe(false);
  });
});

describe('hasActiveNote', () => {
  it('is true when a note object is present', () => {
    expect(hasActiveNote(group({ note: { id: 'n1', text: 'ballin' } }))).toBe(true);
  });

  it('is false for null / missing notes and never leaks a non-boolean', () => {
    expect(hasActiveNote(group({ note: null }))).toBe(false);
    expect(hasActiveNote(group({ note: undefined }))).toBe(false);
    expect(hasActiveNote(undefined)).toBe(false);
  });
});

describe('shouldShowStoryAvatar', () => {
  it('always keeps your own slot, even with no story and no note', () => {
    // This slot doubles as the "Add Story" entry point, so dropping it
    // would strand a brand-new user with no way to post.
    expect(shouldShowStoryAvatar(group({ isOwn: true, stories: [], note: null }))).toBe(true);
  });

  it('keeps someone with an active story', () => {
    expect(shouldShowStoryAvatar(group({ stories: [{ id: 's1' }] }))).toBe(true);
  });

  it('keeps someone with only a status note', () => {
    // The "ballin" bubble is authored content — it earns a slot on its own.
    expect(shouldShowStoryAvatar(group({ note: { id: 'n1', text: 'ballin' } }))).toBe(true);
  });

  it('keeps someone with both a story and a note', () => {
    expect(shouldShowStoryAvatar(group({ stories: [{ id: 's1' }], note: { id: 'n1' } }))).toBe(true);
  });

  it('drops a followed user with neither — the case this rule exists for', () => {
    expect(shouldShowStoryAvatar(group({ stories: [], note: null }))).toBe(false);
  });

  it('drops null / undefined groups instead of throwing', () => {
    expect(shouldShowStoryAvatar(null)).toBe(false);
    expect(shouldShowStoryAvatar(undefined)).toBe(false);
  });
});

describe('filterVisibleStoryGroups', () => {
  it('keeps only own / story / note groups', () => {
    const groups = [
      group({ user_id: 'me',    isOwn: true }),
      group({ user_id: 'story', stories: [{ id: 's1' }] }),
      group({ user_id: 'note',  note: { id: 'n1' } }),
      group({ user_id: 'empty' }),
      group({ user_id: 'empty2' }),
    ];
    expect(filterVisibleStoryGroups(groups).map(g => g.user_id))
      .toEqual(['me', 'story', 'note']);
  });

  it('preserves the incoming order rather than re-sorting', () => {
    // fetchStoriesFeed already sorts own-first / has-content / unseen-first.
    const groups = [
      group({ user_id: 'b', stories: [{ id: 's1' }] }),
      group({ user_id: 'a', note: { id: 'n1' } }),
      group({ user_id: 'c', stories: [{ id: 's2' }] }),
    ];
    expect(filterVisibleStoryGroups(groups).map(g => g.user_id))
      .toEqual(['b', 'a', 'c']);
  });

  it('can return just the own slot when nobody has posted', () => {
    const groups = [
      group({ user_id: 'me', isOwn: true }),
      group({ user_id: 'x' }),
      group({ user_id: 'y' }),
    ];
    expect(filterVisibleStoryGroups(groups).map(g => g.user_id)).toEqual(['me']);
  });

  it('returns an empty array for non-array input', () => {
    expect(filterVisibleStoryGroups(undefined)).toEqual([]);
    expect(filterVisibleStoryGroups(null)).toEqual([]);
    expect(filterVisibleStoryGroups({})).toEqual([]);
  });
});

/**
 * `orderStoryGroups` — the 12 Aug reversal.
 *
 * Sean, repeatedly and finally in writing: "it needs to show your friends
 * first even if your friends don't have anything posted… this is something
 * I've tried talking about for a long time."
 *
 * The rule above (filterVisibleStoryGroups) DROPPED those friends, for a real
 * reason: a wall of greyed-out avatars buried the two people who had actually
 * posted. Ordering answers that objection without the side effect of a friend
 * ceasing to exist on the home screen when they go quiet for a week.
 *
 * The stability assertion is the one most likely to be broken by a later
 * "tidy-up": fetchStoriesFeed has already applied unseen-first ordering within
 * the has-story band, and a re-sort that is not stable silently throws that
 * away. Nothing would look broken — the unseen stories would just stop coming
 * first, which nobody would trace back to a sort.
 */
describe('orderStoryGroups', () => {
  const own   = { isOwn: true,  user_id: 'me',  stories: [] };
  const story = (id) => ({ user_id: id, stories: [{ id: id + '-s' }] });
  const note  = (id) => ({ user_id: id, stories: [], note: { id: id + '-n', text: 'hi' } });
  const bare  = (id) => ({ user_id: id, stories: [] });

  it('keeps everyone — nobody is dropped', () => {
    const input = [bare('a'), story('b'), own, note('c')];
    expect(orderStoryGroups(input)).toHaveLength(4);
  });

  it('puts own first, then stories, then notes, then the rest', () => {
    const out = orderStoryGroups([bare('a'), note('c'), story('b'), own]);
    expect(out.map(g => g.user_id)).toEqual(['me', 'b', 'c', 'a']);
  });

  it('shows a friend with nothing posted rather than hiding them', () => {
    const out = orderStoryGroups([own, bare('quiet')]);
    expect(out.map(g => g.user_id)).toContain('quiet');
  });

  it('is STABLE within a band, preserving unseen-first from the fetch', () => {
    const a = { user_id: 'a', stories: [{ id: 1 }], hasUnseen: true };
    const b = { user_id: 'b', stories: [{ id: 2 }], hasUnseen: false };
    const c = { user_id: 'c', stories: [{ id: 3 }], hasUnseen: true };
    expect(orderStoryGroups([a, b, c]).map(g => g.user_id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the input array', () => {
    const input = [bare('a'), own];
    const copy = [...input];
    orderStoryGroups(input);
    expect(input).toEqual(copy);
  });

  it('survives malformed input', () => {
    expect(orderStoryGroups(null)).toEqual([]);
    expect(orderStoryGroups(undefined)).toEqual([]);
    expect(orderStoryGroups([])).toEqual([]);
  });
});

describe('rowStoryGroups (placeholder circles, 2026-09-26)', () => {
  // Imported lazily so this block does not disturb the import list above.
  const load = () => import('@/lib/storiesRowVisibility');

  it('drops a followed account with no name, no picture and nothing posted', async () => {
    const { rowStoryGroups } = await load();
    const own = group({ user_id: 'me', isOwn: true, isPlaceholder: true });
    const ghost = group({ user_id: 'g1', isPlaceholder: true });
    expect(rowStoryGroups([ghost, own]).map((g) => g.user_id)).toEqual(['me']);
  });

  it('keeps named friends with nothing posted (Sean\'s rule)', async () => {
    const { rowStoryGroups } = await load();
    const friend = group({ user_id: 'f1', isPlaceholder: false });
    expect(rowStoryGroups([friend]).map((g) => g.user_id)).toEqual(['f1']);
  });

  it('keeps a placeholder that has a story or a note', async () => {
    const { rowStoryGroups } = await load();
    const withStory = group({ user_id: 's1', isPlaceholder: true, stories: [{ id: 'x' }] });
    const withNote = group({ user_id: 'n1', isPlaceholder: true, note: { id: 'n' } });
    expect(rowStoryGroups([withNote, withStory]).map((g) => g.user_id)).toEqual(['s1', 'n1']);
  });

  it('treats a group without the flag as real', async () => {
    const { isPlaceholderGroup } = await load();
    expect(isPlaceholderGroup(group())).toBe(false);
    expect(isPlaceholderGroup(null)).toBe(false);
  });
});
