// Settings' back button, which had a bug you could walk into in three taps.
//
// The header arrow used to PUSH `/settings` when leaving a subpage, so
// caller → index → subpage → back left the history stack at
// [caller, /settings, /settings/x, /settings]. The index's own
// `navigate(-1)` then went to `/settings/x` — you tapped Back on the main
// Settings page and landed back inside Settings, one level deeper than
// where you started. It also meant the arrow and the hardware back button
// disagreed about the same tap.
//
// These assert on the resulting PATH after each tap rather than on how the
// component navigates, so a future rewrite that keeps the behaviour keeps
// the tests.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, fb, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), fb) : fb,
  }),
}));
vi.mock('@/components/ErrorBoundary', () => ({
  default: ({ children }) => children,
}));

// The seven subpages are lazy chunks and none of them matter here — the
// header and its arrow live in the page itself.
for (const name of ['Preferences', 'Notifications', 'Training', 'Body', 'Privacy', 'Account', 'About']) {
  vi.doMock(`@/components/settings/${name}Section`, () => ({
    default: () => React.createElement('div', null, `${name} section`),
  }));
}

const { default: Settings } = await import('../Settings');

function Probe() {
  const loc = useLocation();
  return React.createElement('div', { 'data-testid': 'at' }, loc.pathname);
}

const mount = (entries, index) =>
  render(
    React.createElement(MemoryRouter, { initialEntries: entries, initialIndex: index },
      React.createElement(React.Fragment, null,
        React.createElement(Probe),
        React.createElement(Routes, null,
          React.createElement(Route, { path: '/settings', element: React.createElement(Settings) }),
          React.createElement(Route, { path: '/settings/:section', element: React.createElement(Settings) }),
          React.createElement(Route, { path: '/dashboard', element: React.createElement('div', null, 'dashboard') }),
          React.createElement(Route, { path: '/hub', element: React.createElement('div', null, 'hub') }),
        ))));

const at = () => screen.getByTestId('at').textContent;
const tapBack = async (user) => {
  await user.click(await screen.findByLabelText('Back'));
};

describe('Settings back button', () => {
  let user;
  beforeEach(() => { user = userEvent.setup(); });

  it('leaves a subpage by POPPING, so the index still sits on the caller', async () => {
    // The reproduction: /hub → index → subpage. Leaving the subpage must not
    // add a fourth entry, or the index's own back walks into the subpage.
    mount(['/hub', '/settings', '/settings/notifications'], 2);
    expect(at()).toBe('/settings/notifications');

    await tapBack(user);
    await waitFor(() => expect(at()).toBe('/settings'));

    await tapBack(user);
    await waitFor(() => expect(at()).toBe('/hub'));
  });

  it('returns to whichever page the user came from, not a hardcoded parent', async () => {
    mount(['/dashboard', '/settings'], 1);
    await tapBack(user);
    await waitFor(() => expect(at()).toBe('/dashboard'));
  });

  it('falls back to the Dashboard when the index was deep-linked cold', async () => {
    // Nothing of ours behind us — `navigate(-1)` here would leave the app.
    mount(['/settings'], 0);
    await tapBack(user);
    await waitFor(() => expect(at()).toBe('/dashboard'));
  });

  it('swaps the index in when a SUBPAGE was deep-linked cold, then exits to the Dashboard', async () => {
    // A support reply linking /settings/privacy directly. Back must reach the
    // index (there is nothing to pop), and back again must not strand the
    // user on a page whose own back button does nothing.
    mount(['/settings/privacy'], 0);
    expect(at()).toBe('/settings/privacy');

    await tapBack(user);
    await waitFor(() => expect(at()).toBe('/settings'));

    await tapBack(user);
    await waitFor(() => expect(at()).toBe('/dashboard'));
  });

  it('sends an unknown slug to the index instead of rendering a broken page', async () => {
    mount(['/settings/not-a-real-section'], 0);
    await waitFor(() => expect(at()).toBe('/settings'));
  });
});
