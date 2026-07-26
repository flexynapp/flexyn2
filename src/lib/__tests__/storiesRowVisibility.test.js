import { describe, it, expect } from 'vitest';
import {
  hasActiveStory,
  hasActiveNote,
  shouldShowStoryAvatar,
  filterVisibleStoryGroups,
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
