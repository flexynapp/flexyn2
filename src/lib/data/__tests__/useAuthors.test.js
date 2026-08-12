/**
 * resolveAuthor — how a post or comment decides what to call its author.
 *
 * A display name is a NEW second identity field, and the trap it creates is
 * printing the same word twice: posts snapshot `author_name`, which has always
 * been the handle, so any fallback from display_name to the snapshot would
 * render "sean @sean" on every legacy row. The tests below pin that the
 * display name comes from the LIVE record only.
 *
 * The resolver is pure, so it is tested directly rather than through a feed
 * card with six queries and a realtime channel behind it.
 */
import { describe, it, expect } from 'vitest';
import { resolveAuthor } from '@/lib/data/useAuthors';

const byId = {
  'u-1': { id: 'u-1', username: 'evrock', display_name: 'Ev', avatar_url: 'https://a/1.jpg' },
  'u-2': { id: 'u-2', username: 'plainjane', display_name: null },
  'u-3': { id: 'u-3', username: 'blanky', display_name: '   ' },
};

describe('resolveAuthor — display name', () => {
  it('returns the live display name alongside the handle', () => {
    const a = resolveAuthor(byId, 'u-1', {});
    expect(a.displayName).toBe('Ev');
    expect(a.handle).toBe('@evrock');
  });

  it('is null when the user has not set one — the handle stands alone', () => {
    // This is every account today (0 of 57 have a display_name), so it is the
    // path that must not change.
    expect(resolveAuthor(byId, 'u-2', {}).displayName).toBeNull();
  });

  it('treats a whitespace-only display name as none', () => {
    // Otherwise the card renders a bold empty line above the handle.
    expect(resolveAuthor(byId, 'u-3', {}).displayName).toBeFalsy();
  });

  it('never takes the display name from the post snapshot', () => {
    // author_name IS the handle on every existing row. Falling back to it
    // would print "@ghost" as both the name and the handle on one line.
    const a = resolveAuthor(byId, 'u-unknown', { author_name: '@ghost' });
    expect(a.handle).toBe('@ghost');
    expect(a.displayName).toBeNull();
  });

  it('still resolves a deleted author to the snapshot handle', () => {
    const a = resolveAuthor({}, 'gone', { author_name: 'oldhandle' });
    expect(a.handle).toBe('@oldhandle');
    expect(a.displayName).toBeNull();
  });

  it('falls back to @athlete when there is nothing at all', () => {
    const a = resolveAuthor({}, null, {});
    expect(a.handle).toBe('@athlete');
    expect(a.displayName).toBeNull();
  });

  it('keeps the existing fields intact', () => {
    // Adding a field must not disturb what the cards already read.
    const a = resolveAuthor(byId, 'u-1', {});
    expect(a.username).toBe('evrock');
    expect(a.avatarUrl).toBe('https://a/1.jpg');
    expect(a.initials).toBe('EV');
  });
});
