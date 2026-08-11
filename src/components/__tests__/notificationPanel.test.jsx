// The notifications sheet, driven against the four defects it was rebuilt
// to fix. Each `describe` below names one; none of them could be seen by
// reading the old file, which is why they survived several passes.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const markAllRead = vi.fn(async () => {});
const deleteAllForUser = vi.fn(async () => ({ ok: true }));
const deleteNotification = vi.fn(async () => ({ ok: true }));
const markRead = vi.fn(async () => ({ ok: true }));
let listRows = [];

vi.mock('@/lib/data/notifications', () => ({
  listForUser: vi.fn(async () => listRows),
  markAllRead: (...a) => markAllRead(...a),
  markRead: (...a) => markRead(...a),
  deleteNotification: (...a) => deleteNotification(...a),
  deleteAllForUser: (...a) => deleteAllForUser(...a),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@x.com' } }) }));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    t: (k) => k,
    tFallback: (_k, fb, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), fb) : fb,
  }),
}));
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));
vi.mock('@/lib/toast', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  useDragControls: () => ({ start: vi.fn() }),
  motion: new Proxy({}, {
    get: (_t, tag) => ({ children, ...p }) => {
      const {
        initial, animate, exit, transition, layout, drag, dragControls, dragConstraints,
        dragElastic, dragListener, dragDirectionLock, onDragEnd, whileDrag, whileTap, ...rest
      } = p;
      return React.createElement(String(tag), rest, children);
    },
  }),
}));

const { default: NotificationPanel } = await import('../NotificationPanel');

const row = (o) => ({
  id: o.id, type: o.type, title: o.title, body: o.body ?? null,
  icon: o.icon ?? '🔔', link_url: o.link_url ?? null,
  is_read: o.is_read ?? false,
  created_at: o.created_at ?? new Date().toISOString(),
});

function renderPanel(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const onClose = props.onClose || vi.fn();
  const view = render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(NotificationPanel, { open: true, onClose })),
  );
  return { ...view, onClose, qc };
}

beforeEach(() => {
  vi.clearAllMocks();
  listRows = [
    row({ id: 'n1', type: 'friend_follow', title: 'Dani followed you', is_read: false }),
    row({ id: 'n2', type: 'coin_gift',     title: 'Alex sent you coins', is_read: false }),
    row({ id: 'n3', type: 'pr_set',        title: 'New Bench PR',        is_read: true }),
    row({ id: 'n4', type: 'welcome_back',  title: 'We miss you',         is_read: true }),
  ];
});

// ── 1 ────────────────────────────────────────────────────────────────────
// The old effect fired markAllRead on OPEN and invalidated the list, so the
// unread treatment was replaced by its read state within one round trip —
// visible for less time than it takes to read a row.
describe('read is committed on exit, not on entry', () => {
  it('marks nothing while the sheet is open', async () => {
    renderPanel();
    await screen.findByText('Dani followed you');
    // Give any stray effect a chance to fire.
    await act(async () => { await Promise.resolve(); });
    expect(markAllRead).not.toHaveBeenCalled();
  });

  it('keeps unread rows looking unread for the whole visit', async () => {
    renderPanel();
    const unread = await screen.findByText('Dani followed you');
    const read = screen.getByText('New Bench PR');
    await act(async () => { await Promise.resolve(); });
    expect(unread.className).toContain('font-semibold');
    expect(read.className).not.toContain('font-semibold');
  });

  it('marks all read when the sheet is closed', async () => {
    const { onClose } = renderPanel();
    await screen.findByText('Dani followed you');
    fireEvent.click(screen.getByLabelText('Close'));
    await waitFor(() => expect(markAllRead).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not call the server when there was nothing unread', async () => {
    listRows = listRows.map(r => ({ ...r, is_read: true }));
    renderPanel();
    await screen.findByText('Dani followed you');
    fireEvent.click(screen.getByLabelText('Close'));
    await act(async () => { await Promise.resolve(); });
    expect(markAllRead).not.toHaveBeenCalled();
  });

  it('marks read exactly once even if close fires twice', async () => {
    renderPanel();
    await screen.findByText('Dani followed you');
    const close = screen.getByLabelText('Close');
    fireEvent.click(close);
    fireEvent.click(close);
    await waitFor(() => expect(markAllRead).toHaveBeenCalledTimes(1));
  });
});

// ── 2 ────────────────────────────────────────────────────────────────────
// "Mark all read" rendered on `hasUnread` — the same condition the open
// effect had already falsified. The control existed and could not be used.
describe('the mark-all-read control is reachable', () => {
  it('is present while there are unread rows', async () => {
    renderPanel();
    await screen.findByText('Dani followed you');
    expect(screen.getByLabelText('Mark all as read')).toBeInTheDocument();
  });

  it('marks read when pressed, without closing the sheet', async () => {
    const { onClose } = renderPanel();
    await screen.findByText('Dani followed you');
    fireEvent.click(screen.getByLabelText('Mark all as read'));
    await waitFor(() => expect(markAllRead).toHaveBeenCalledTimes(1));
    expect(onClose).not.toHaveBeenCalled();
  });
});

// ── 3 ────────────────────────────────────────────────────────────────────
// Two type→tab maps, neither of which knew about `coin_gift`.
describe('filters come from the shared catalog', () => {
  it('offers all five, from notificationCatalog', async () => {
    renderPanel();
    await screen.findByText('Dani followed you');
    for (const label of ['All', 'Friends', 'Competitive', 'Achievements', 'Reminders']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${label}`) })).toBeInTheDocument();
    }
  });

  it('files coin_gift under Friends, not a catch-all', async () => {
    renderPanel();
    await screen.findByText('Alex sent you coins');
    fireEvent.click(screen.getByRole('button', { name: /^Friends/ }));
    expect(screen.getByText('Alex sent you coins')).toBeInTheDocument();
    expect(screen.queryByText('New Bench PR')).not.toBeInTheDocument();
  });

  it('shows a filter-specific empty state rather than "nothing at all"', async () => {
    renderPanel();
    await screen.findByText('Dani followed you');
    fireEvent.click(screen.getByRole('button', { name: /^Competitive/ }));
    expect(screen.getByText('Nothing in this filter')).toBeInTheDocument();
  });
});

// ── 4 ────────────────────────────────────────────────────────────────────
// `window.confirm` — a native OS dialog inside an installed PWA — and it
// counted the wrong rows when a filter was on.
describe('clear all confirms in-app', () => {
  it('never reaches window.confirm', async () => {
    const nativeConfirm = vi.fn(() => true);
    vi.stubGlobal('confirm', nativeConfirm);
    renderPanel();
    await screen.findByText('Dani followed you');
    fireEvent.click(screen.getByLabelText('More options'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Clear all/ }));
    expect(nativeConfirm).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('states the true total, and cancels without deleting', async () => {
    renderPanel();
    await screen.findByText('Dani followed you');
    fireEvent.click(screen.getByLabelText('More options'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Clear all/ }));
    expect(screen.getByText('Clear all 4 notifications?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(deleteAllForUser).not.toHaveBeenCalled();
  });

  it('names the rows the active filter is hiding', async () => {
    renderPanel();
    await screen.findByText('Dani followed you');
    fireEvent.click(screen.getByRole('button', { name: /^Friends/ }));
    fireEvent.click(screen.getByLabelText('More options'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Clear all/ }));
    // 4 rows, 2 of them social — so 2 are hidden and about to go too.
    expect(screen.getByText(/including the 2 hidden by the current filter/)).toBeInTheDocument();
  });

  it('deletes only on confirm', async () => {
    renderPanel();
    await screen.findByText('Dani followed you');
    fireEvent.click(screen.getByLabelText('More options'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Clear all/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    await waitFor(() => expect(deleteAllForUser).toHaveBeenCalledTimes(1));
  });
});

// ── 5 ────────────────────────────────────────────────────────────────────
// Both of these were found by rendering the component for real, in a
// harness, after the tests above were already green. jsdom computes no
// layout and paints nothing, so neither was reachable from here first.
describe('found by looking at it', () => {
  it('counts "N new" within the active filter, not across the whole sheet', async () => {
    renderPanel();
    await screen.findByText('Dani followed you');
    // 2 unread overall, both social; the sheet-wide count is 2 either way,
    // so pick a filter where the two numbers genuinely differ.
    expect(screen.getByText('2 new')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Competitive/ }));
    // Nothing competitive, so no pill at all rather than "2 new" over an
    // empty section.
    expect(screen.queryByText('2 new')).not.toBeInTheDocument();
  });

  it('shows the pill only for the unread rows the filter admits', async () => {
    listRows = [
      row({ id: 'a', type: 'friend_follow', title: 'Social unread', is_read: false }),
      row({ id: 'b', type: 'pr_set',        title: 'Wins unread',   is_read: false }),
    ];
    renderPanel();
    await screen.findByText('Social unread');
    expect(screen.getByText('2 new')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Friends/ }));
    expect(screen.getByText('1 new')).toBeInTheDocument();
  });

  it('stops the swipe reveal short of the row divider', () => {
    // The divider is a sibling of the drag container, so nothing opaque
    // covers it: an `inset-y-0` reveal paints through its 60%-alpha hairline
    // and the last 120px of EVERY divider renders destructive red, on rows
    // nobody is touching. jsdom cannot see that — this guards the source.
    const src = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../NotificationPanel.jsx'), 'utf8');
    const reveal = src.match(/className="absolute [^"]*w-\[120px\][^"]*"/)[0];
    expect(reveal).toContain('bottom-px');
    expect(reveal).not.toContain('inset-y-0');
  });
});

describe('a11y and chrome', () => {
  it('moves focus into the sheet on open', async () => {
    renderPanel();
    await screen.findByText('Dani followed you');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Close')));
  });

  it('announces the unread count and nothing larger', async () => {
    const { container } = renderPanel();
    await screen.findByText('Dani followed you');
    const live = container.ownerDocument.body.querySelectorAll('[aria-live="polite"]');
    expect(live).toHaveLength(1);
    expect(live[0].textContent).toBe('2 unread notifications');
  });

  it('groups rows by day', async () => {
    listRows = [
      row({ id: 'a', type: 'pr_set', title: 'Today row', created_at: new Date().toISOString() }),
      row({ id: 'b', type: 'pr_set', title: 'Old row', created_at: '2026-01-02T10:00:00Z' }),
    ];
    renderPanel();
    await screen.findByText('Today row');
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('Earlier')).toBeInTheDocument();
    expect(screen.queryByText('Yesterday')).not.toBeInTheDocument();
  });

  it('gives every row a delete control, not only the swipe', async () => {
    renderPanel();
    await screen.findByText('Dani followed you');
    expect(screen.getAllByLabelText('Delete')).toHaveLength(4);
  });
});
