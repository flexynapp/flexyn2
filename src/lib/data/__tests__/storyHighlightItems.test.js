/**
 * Story Highlight albums opened empty from the day the feature shipped.
 *
 * `listItemsForHighlight` embedded `stories(id, image_url, video_url,
 * created_at)`. `stories` has no `video_url` column — video has always been
 * `image_url` plus `media_type = 'video'` (mig 045); `video_url` belongs to
 * `hub_posts`, which is where the name was borrowed from. PostgREST rejects
 * the WHOLE embed when the column list names something that does not exist,
 * and the function's `if (error) return []` turned that rejection into an
 * empty array. HubProfile reads an empty array as an empty album and shows
 * "This album is empty." — so a total failure and a genuinely empty album
 * were indistinguishable, which is why nobody could report it as a bug.
 *
 * The mock below is a PostgREST stand-in rather than a stub that always
 * succeeds: it rejects any select naming a column outside the real table,
 * so the old string fails these tests and the new one passes. A mock that
 * ignored the column list would go green against the bug.
 *
 * STORY_COLUMNS is the live shape of public.stories, and the second test
 * pins it — if someone drops a column the viewer needs, the failure names
 * it here instead of surfacing as another silently empty album.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// public.stories, verified against information_schema on 2026-08-22.
const STORY_COLUMNS = new Set([
  'id', 'user_id', 'user_email', 'image_url', 'created_at', 'expires_at',
  'overlay_text', 'media_type', 'overlay_style', 'privacy', 'crew_id', 'overlays',
]);
const ITEM_COLUMNS = new Set(['id', 'highlight_id', 'story_id', 'added_at']);

const ROW = {
  id: 'item-1',
  story_id: 'story-1',
  added_at: '2026-08-01T00:00:00Z',
  stories: { id: 'story-1', image_url: 'https://cdn/x.jpg', media_type: 'image' },
};

let lastSelect = null;

/** Parse `a, b, rel(c, d)` into { own: [...], embeds: { rel: [...] } }. */
function parseSelect(sel) {
  const embeds = {};
  const own = [];
  // Strip each `rel(...)` group out, recording its columns, then split the rest.
  const rest = sel.replace(/(\w+)\(([^)]*)\)/g, (_, rel, cols) => {
    embeds[rel] = cols.split(',').map((c) => c.trim()).filter(Boolean);
    return '';
  });
  for (const c of rest.split(',')) if (c.trim()) own.push(c.trim());
  return { own, embeds };
}

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: () => {
      const c = {
        select: (sel) => { lastSelect = sel; return c; },
        eq: () => c,
        order: () => c,
        then: (onF, onR) => {
          const { own, embeds } = parseSelect(lastSelect || '');
          const bad = [
            ...own.filter((col) => !ITEM_COLUMNS.has(col)).map((col) => `story_highlight_items.${col}`),
            ...(embeds.stories || [])
              .filter((col) => !STORY_COLUMNS.has(col))
              .map((col) => `stories.${col}`),
          ];
          // What PostgREST actually answers: 400, no rows, whole query lost.
          const res = bad.length
            ? { data: null, error: { code: '42703', message: `column ${bad[0]} does not exist` } }
            : { data: [ROW], error: null };
          return Promise.resolve(res).then(onF, onR);
        },
      };
      return c;
    },
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getUser: async () => ({ data: { user: { id: 'me', email: 'me@x.com' } } }),
    },
  },
}));
vi.mock('@/lib/profanityFilter', () => ({ containsProfanity: () => false }));

import { listItemsForHighlight } from '../storyHighlights';

beforeEach(() => { lastSelect = null; });

describe('listItemsForHighlight', () => {
  it('returns the album contents instead of losing them to a rejected embed', async () => {
    const items = await listItemsForHighlight('album-1');
    expect(items).toHaveLength(1);
    expect(items[0].stories.id).toBe('story-1');
  });

  it('asks only for columns that exist on stories', async () => {
    await listItemsForHighlight('album-1');
    const { embeds } = parseSelect(lastSelect);
    const unknown = (embeds.stories || []).filter((c) => !STORY_COLUMNS.has(c));
    expect(unknown, 'these columns are not on public.stories').toEqual([]);
    expect(embeds.stories).toContain('id');
  });

  it('asks for every column StoryViewer renders, so a highlight is not a stripped story', async () => {
    await listItemsForHighlight('album-1');
    const { embeds } = parseSelect(lastSelect);
    // StoryViewer reads all of these off each story: media_type picks the
    // <video> branch, and the three overlay columns are the text and
    // stickers the author put on it. The original select had none of them,
    // so even once the 400 was gone a highlight would have replayed every
    // video as a still image with its overlays missing.
    for (const col of ['media_type', 'overlay_text', 'overlay_style', 'overlays', 'created_at']) {
      expect(embeds.stories, `StoryViewer reads stories.${col}`).toContain(col);
    }
  });
});
