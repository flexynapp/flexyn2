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
vi.mock('@/lib/data/notifications', () => ({ unreadCount: vi.fn(async () => 2) }));
vi.mock('@/lib/data/hubMessages', () => ({ unreadCountFor: vi.fn(async () => 0) }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  motion: new Proxy({}, {
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

describe('the badge', () => {
  it('shows the count, then stays down while the sheet is open', async () => {
    setDesktop(false);
    const { qc } = renderBells();
    const [, header] = await screen.findAllByRole('button', { name: /2 unread notifications/ });
    fireEvent.click(header);
    expect(screen.getByTestId('panel').textContent).toBe('opened with 2');
    // Both bells share the query, so the optimistic clear drops both badges.
    await waitFor(() => expect(screen.queryAllByText('2')).toHaveLength(0));

    // The 30 s poll (or a row being marked read) lands while the sheet is
    // up and reports what is still unread. The open bell must not re-light.
    act(() => { qc.setQueryData(['notificationsUnread', 'me'], 1); });
    // The closed sidebar bell proves the new value arrived; the open one
    // must still read as clear.
    await waitFor(() => expect(screen.getAllByRole('button')[0].getAttribute('aria-label'))
      .toBe('Notifications, 1 unread notification'));
    expect(screen.getAllByRole('button')[1].getAttribute('aria-label')).toBe('Notifications');
  });
});
