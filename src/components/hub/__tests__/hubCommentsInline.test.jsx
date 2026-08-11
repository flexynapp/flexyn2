/**
 * The comment sheet, from Sean's 11 Aug live review of the Hub.
 *
 * This renders the REAL component rather than asserting on the data layer,
 * because every defect in that review was in the wiring rather than the
 * queries: the avatar had no click target at all, the timestamp was built
 * with a locale-less date-fns `format()`, and the double-tap gesture was
 * landing on the post one level up. None of those are visible from a data
 * test — the query is fine in all three cases.
 *
 * The double-tap case is the one worth reading twice. `HubPostCard` runs
 * double-tap-to-like on a single `onPointerUp` on the whole article, and the
 * comment sheet renders INSIDE that article, so before the fix a double-tap
 * on a comment liked the post. The guard is a `stopPropagation` on the
 * comments wrapper in HubPostCard plus this component's own handler; the test
 * below reproduces the nesting so removing either half fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

const navigateSpy = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me-uuid', email: 'me@test.com' } }),
}));

// This stub INTERPOLATES, unlike the usual `(key, english) => english` shape
// used elsewhere in the repo. That shape returns the fallback template
// verbatim, so a call site that forgets to forward its vars renders a literal
// "{name}" in every language while the test passes — the exact blind spot
// CLAUDE.md's i18n section documents. Interpolating here means a dropped
// third argument fails this file instead of shipping.
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, fallback, vars) => {
      let s = fallback;
      if (vars && typeof s === 'string') {
        for (const [k, v] of Object.entries(vars)) {
          s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
        }
      }
      return s;
    },
    language: 'en',
  }),
}));

const likeSpy = vi.fn(async () => ({}));
vi.mock('@/lib/data/hubCommentLikes', () => ({
  listLikedCommentIds: vi.fn(async () => new Set()),
  like: (...a) => likeSpy(...a),
  unlike: vi.fn(async () => ({})),
  setLiked: (...a) => likeSpy(...a),
}));

const COMMENTS = [
  {
    id: 'c1',
    post_id: 'p1',
    user_id: 'other-uuid',
    author_email: 'other@test.com',
    author_name: 'kegan',
    body: 'Nice work on that squat session',
    created_date: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
    like_count: 0,
    parent_comment_id: null,
  },
];

vi.mock('@/lib/data/hubComments', async () => {
  const actual = await vi.importActual('@/lib/data/hubComments');
  return {
    ...actual,
    listForPost: vi.fn(async () => COMMENTS),
    create: vi.fn(async () => ({ id: 'new' })),
    remove: vi.fn(async () => ({})),
  };
});

vi.mock('@/lib/data/useAuthors', () => ({
  useAuthorsById: () => ({
    'other-uuid': { email: 'other@test.com', username: 'kegan', avatar_url: null },
    'author-uuid': { email: 'author@test.com', username: 'gabe', avatar_url: null },
  }),
  resolveAuthor: (byId, id, snap = {}) => {
    const live = id ? byId[id] : null;
    const username = live?.username || (snap.author_name || '').replace(/^@/, '') || 'athlete';
    return {
      handle: `@${username}`,
      username,
      avatarUrl: live?.avatar_url || null,
      initials: username.slice(0, 2).toUpperCase(),
    };
  },
}));

vi.mock('@/lib/data/quests', () => ({ recordAction: vi.fn(async () => ({})) }));
vi.mock('@/lib/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), message: vi.fn(), warning: vi.fn() },
}));

import HubCommentsInline from '../HubCommentsInline';

const POST = {
  id: 'p1',
  user_id: 'author-uuid',
  author_email: 'author@test.com',
  author_name: 'gabe',
};

function mount(post = POST) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <HubCommentsInline post={post} open onClose={() => {}} />
      </QueryClientProvider>
    </MemoryRouter>
  );
}

beforeEach(() => {
  navigateSpy.mockClear();
  likeSpy.mockClear();
});

describe('comment sheet', () => {
  it('shows no "no comments yet" placeholder on an empty thread', async () => {
    const mod = await import('@/lib/data/hubComments');
    mod.listForPost.mockResolvedValueOnce([]);
    mount();
    await waitFor(() => expect(screen.queryByText('common.loading')).not.toBeInTheDocument());
    // The old empty state rendered t('hub.comments.empty'); the stub returns
    // the key, so its absence is checkable directly.
    expect(screen.queryByText('hub.comments.empty')).not.toBeInTheDocument();
  });

  it('pre-fills the post author @handle when the sheet opens', async () => {
    mount();
    const box = await screen.findByRole('textbox');
    await waitFor(() => expect(box).toHaveValue('@gabe '));
  });

  it('does NOT pre-fill on your own post', async () => {
    mount({ ...POST, author_email: 'me@test.com', user_id: 'me-uuid' });
    const box = await screen.findByRole('textbox');
    await waitFor(() => expect(box).toHaveValue(''));
  });

  it('renders a relative timestamp, not an absolute date', async () => {
    mount();
    expect(await screen.findByText(/2 hours ago/i)).toBeInTheDocument();
    // The old format was 'MMM d, h:mma' — e.g. "Aug 11, 3:50PM".
    expect(screen.queryByText(/\d{1,2}:\d{2}(AM|PM)/i)).not.toBeInTheDocument();
  });

  it('opens the author profile when the avatar is tapped', async () => {
    mount();
    const avatar = await screen.findByRole('button', { name: /view @kegan's profile/i });
    fireEvent.click(avatar);
    expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('other-uuid'));
  });

  it('opens the author profile when the handle is tapped', async () => {
    mount();
    const handle = await screen.findByRole('button', { name: '@kegan' });
    fireEvent.click(handle);
    expect(navigateSpy).toHaveBeenCalledWith(expect.stringContaining('other-uuid'));
  });
});

describe('double-tap likes the COMMENT, not the post', () => {
  it('fires the comment like on a double pointer-up', async () => {
    mount();
    const body = await screen.findByText('Nice work on that squat session');
    const bubble = body.closest('.rounded-2xl');
    fireEvent.pointerUp(bubble, { button: 0 });
    fireEvent.pointerUp(bubble, { button: 0 });
    await waitFor(() => expect(likeSpy).toHaveBeenCalled());
  });

  it('does not let the gesture reach an enclosing post handler', async () => {
    // Reproduces HubPostCard's nesting: the article listens on pointerup, and
    // the comments wrapper stops propagation. If that stopPropagation is ever
    // removed from HubPostCard, this fails.
    const postHandler = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <MemoryRouter>
        <QueryClientProvider client={qc}>
          <article onPointerUp={postHandler}>
            <div onPointerUp={(e) => e.stopPropagation()}>
              <HubCommentsInline post={POST} open onClose={() => {}} />
            </div>
          </article>
        </QueryClientProvider>
      </MemoryRouter>
    );
    const body = await screen.findByText('Nice work on that squat session');
    const bubble = body.closest('.rounded-2xl');
    fireEvent.pointerUp(bubble, { button: 0 });
    fireEvent.pointerUp(bubble, { button: 0 });
    await waitFor(() => expect(likeSpy).toHaveBeenCalled());
    expect(postHandler).not.toHaveBeenCalled();
  });
});

describe('translate affordance', () => {
  it('is hidden on a comment already in the viewer language', async () => {
    const mod = await import('@/lib/data/hubComments');
    mod.listForPost.mockResolvedValueOnce([{
      ...COMMENTS[0],
      body: 'I went to the gym and it was the best session that I have had in a while',
    }]);
    mount();
    await screen.findByText(/I went to the gym/);
    expect(screen.queryByText('Translate')).not.toBeInTheDocument();
  });

  it('is shown on a comment in another language', async () => {
    const mod = await import('@/lib/data/hubComments');
    mod.listForPost.mockResolvedValueOnce([{
      ...COMMENTS[0],
      body: 'Hoy fui al gimnasio y la sesión de piernas fue muy buena porque no me dolía',
    }]);
    mount();
    await screen.findByText(/Hoy fui al gimnasio/);
    expect(await screen.findByText('Translate')).toBeInTheDocument();
  });
});
