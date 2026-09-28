// NotificationBell is mounted twice by Layout (desktop sidebar + phone
// header, one hidden by CSS). Each owns a portaled panel, so a "hidden" bell's
// sheet is still visible. These pin that only one answers the deep link, and
// that the badge stays down while the sheet is open.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

let search = '';
const navigate = vi.fn();
vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/dashboard', search }),
  useNavigate: () => navigate,
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@x.com' } }) }));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, fb, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), fb) : fb,
  }),
}));
let summary = { total: 2, people: 0 };
vi.mock('@/lib/data/notifications', () => ({ unreadSummary: vi.fn(async () => summary) }));
vi.mock('@/lib/data/hubMessages', () => ({ unreadCountFor: vi.fn(async () => 0) }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  useReducedMotion: () => false,
  motion: new Proxy({}, {
    // eslint-disable-next-line no-unused-vars
    get: (_t, tag) => ({ children, initial, animate, exit, transition, ...rest }) =>
      React.createElement(String(tag), rest, children),
  }),
}));
vi.mock('../NotificationPanel', () => ({
  default: ({ open, unreadAtOpen }) =>
    open ? React.createElement('div', { 'data-testid': 'panel' }, `opened with ${unreadAtOpen}`) : null,
}));

const { default: NotificationBell } = await import('../NotificationBell');

function setDesktop(isDesktop) {
  window.matchMedia = vi.fn(() => ({ matches: isDesktop }));
}

function renderBells() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { qc, ...render(
    React.createElement(QueryClientProvider, { client: qc },
      React.createElement(React.Fragment, null,
        React.createElement(NotificationBell, { surface: 'sidebar' }),
        React.createElement(NotificationBell, null))),
  ) };
}

beforeEach(() => {
  search = '';
  summary = { total: 2, people: 0 };
  vi.clearAllMocks();
});

describe('the ?notifications=1 deep link', () => {
  it('opens exactly one sheet on a phone', async () => {
    setDesktop(false);
    search = '?notifications=1';
    renderBells();
    await waitFor(() => expect(screen.getAllByTestId('panel')).toHaveLength(1));
  });

  it('opens exactly one sheet on desktop', async () => {
    setDesktop(true);
    search = '?notifications=1';
    renderBells();
    await waitFor(() => expect(screen.getAllByTestId('panel')).toHaveLength(1));
  });
});

const badges = () => [...document.querySelectorAll('[data-badge]')].map(b => b.dataset.badge + (b.textContent || ''));

describe('the badge', () => {
  it('shows a dot, not a number, when only the app has something', async () => {
    setDesktop(false);
    renderBells();
    await waitFor(() => expect(badges()).toEqual(['dot', 'dot']));
    // The label still carries the real total for a screen reader.
    expect(screen.getAllByRole('button')[1].getAttribute('aria-label'))
      .toBe('Notifications, 2 unread notifications');
  });

  it('numbers only what people did', async () => {
    summary = { total: 5, people: 3 };
    setDesktop(false);
    renderBells();
    await waitFor(() => expect(badges()).toEqual(['count3', 'count3']));
  });

  it('stays down while the sheet is open, even when a refresh lands', async () => {
    setDesktop(false);
    const { qc } = renderBells();
    const [, header] = await screen.findAllByRole('button', { name: /2 unread notifications/ });
    fireEvent.click(header);
    expect(screen.getByTestId('panel').textContent).toBe('opened with 2');
    await waitFor(() => expect(badges()).toEqual([]));

    // The 30 s poll (or a row being marked read) lands while the sheet is
    // up and reports what is still unread. The open bell must not re-light.
    act(() => { qc.setQueryData(['notificationsUnread', 'me'], { total: 1, people: 1 }); });
    // The closed sidebar bell proves the new value arrived; the open one
    // must still read as clear.
    await waitFor(() => expect(screen.getAllByRole('button')[0].getAttribute('aria-label'))
      .toBe('Notifications, 1 unread notification'));
    expect(screen.getAllByRole('button')[1].getAttribute('aria-label')).toBe('Notifications');
  });

  it('swings the bell only when the unread total goes up', async () => {
    setDesktop(false);
    const { qc } = renderBells();
    await waitFor(() => expect(badges()).toEqual(['dot', 'dot']));
    const swings = () => [...document.querySelectorAll('[data-swing]')].map(e => e.dataset.swing);
    expect(swings()).toEqual(['0', '0']); // the first load does not swing

    act(() => { qc.setQueryData(['notificationsUnread', 'me'], { total: 3, people: 1 }); });
    await waitFor(() => expect(swings()).toEqual(['1', '1']));

    act(() => { qc.setQueryData(['notificationsUnread', 'me'], { total: 3, people: 1 }); });
    act(() => { qc.setQueryData(['notificationsUnread', 'me'], { total: 2, people: 1 }); });
    await waitFor(() => expect(badges()).toEqual(['count1', 'count1']));
    expect(swings()).toEqual(['1', '1']);
  });
});
