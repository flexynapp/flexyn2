// Tapping a person from inside Hub must open their profile on the FIRST tap.
//
// `consumedInitialProfileRef` means "the mount-time ?profile= has been
// accounted for". It was initialised to `false` unconditionally, which is only
// right when a ?profile= was actually present at mount — then the useState
// initializer applies it and the effect must not apply it twice.
//
// Mount on a bare /hub and there IS no mount-time deep link, so the ref was
// lying: the first ?profile= to arrive afterwards was treated as the one the
// initializer had supposedly handled, and silently dropped. The param was
// still stripped from the URL, so the address bar flickered and snapped back
// and the profile never opened. Only a second tap worked. Reached from
// LiveActivityRail, HubFeed's author links and HubCommentsInline; the route
// element is keyed on pathname alone, so Hub never remounts to reset it.
//
// These mount the real Hub and drive it through the router, because the bug
// lives in the interaction between a lazy useState initializer, an effect, and
// a ref — none of which is visible from a pure function.
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'u1', email: 'me@x.com', username: 'me' } }),
}));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, fb, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replace(`{${n}}`, v), fb) : fb,
  }),
}));
vi.mock('@/lib/hubMessaging', () => ({ useStartConversation: () => vi.fn() }));
vi.mock('@/hooks/useHubUnreadDot', () => ({ markHubVisited: vi.fn() }));

// The profile surface is the assertion target: whatever target it receives is
// what the deep link resolved to.
vi.mock('@/components/hub/HubProfile', () => ({
  default: ({ targetUser }) => (
    <div data-testid="profile">{targetUser?.email || targetUser?.id || 'self'}</div>
  ),
}));
vi.mock('@/components/hub/HubFeed', () => ({ default: () => <div data-testid="feed" /> }));
vi.mock('@/components/hub/HubComposer', () => ({ default: () => <div /> }));
vi.mock('@/components/hub/HubSearchOverlay', () => ({ default: () => <div /> }));
vi.mock('@/components/hub/FollowerActivityBanner', () => ({ default: () => <div /> }));
vi.mock('@/components/hub/LiveActivityRail', () => ({ default: () => <div /> }));
vi.mock('@/components/hub/FollowSuggestionRail', () => ({ default: () => <div /> }));
vi.mock('@/components/stories/StoriesRow', () => ({ default: () => <div /> }));
vi.mock('@/components/crews/CrewsSection', () => ({ default: () => <div /> }));
vi.mock('@/components/ErrorBoundary', () => ({ default: ({ children }) => <>{children}</> }));

import Hub from '../Hub';

// Stands in for every in-app caller: a rail or author link that navigates to
// ?profile= while Hub is already mounted.
function TapSomeone({ email }) {
  const navigate = useNavigate();
  return (
    <button onClick={() => navigate(`/hub?profile=${encodeURIComponent(email)}`)}>
      open {email}
    </button>
  );
}

function renderAt(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <TapSomeone email="friend@x.com" />
      <Routes><Route path="/hub" element={<Hub />} /></Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => vi.clearAllMocks());

describe('Hub ?profile= deep link', () => {
  it('opens the profile on the FIRST in-app tap from a bare /hub', async () => {
    // The regression. Before the fix this rendered the feed and the tap was
    // swallowed; only a second tap worked.
    renderAt('/hub');
    expect(screen.getByTestId('feed')).toBeTruthy();

    screen.getByText('open friend@x.com').click();

    await waitFor(() => expect(screen.getByTestId('profile')).toBeTruthy());
    expect(screen.getByTestId('profile').textContent).toBe('friend@x.com');
  });

  it('still opens the profile when ?profile= is present at mount', async () => {
    // The case the ref exists for: the useState initializer already applied it,
    // and the effect must not fight that or double-apply.
    renderAt('/hub?profile=someone%40x.com');
    await waitFor(() => expect(screen.getByTestId('profile')).toBeTruthy());
    expect(screen.getByTestId('profile').textContent).toBe('someone@x.com');
  });

  it('applies a second, different ?profile= while already on a profile', async () => {
    renderAt('/hub?profile=someone%40x.com');
    await waitFor(() => expect(screen.getByTestId('profile')).toBeTruthy());

    screen.getByText('open friend@x.com').click();

    await waitFor(() =>
      expect(screen.getByTestId('profile').textContent).toBe('friend@x.com'));
  });

  it('strips the param so a back-nav does not re-fire it', async () => {
    renderAt('/hub');
    screen.getByText('open friend@x.com').click();
    await waitFor(() => expect(screen.getByTestId('profile')).toBeTruthy());
    // The effect navigates with replace to clean the URL.
    await waitFor(() => expect(window.location.search).not.toContain('profile='));
  });
});
