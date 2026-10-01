// Today's Widgets quick-action tile opens the widget library from OUTSIDE
// DashboardWidgets by bumping `libraryRequest`. It used to scroll to the
// library's section instead, which Today hides by default, so the tap did
// nothing (audit, 2026-09-30).

import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (k) => k,
    tFallback: (_k, en, vars) => (vars ? en.replace(/\{(\w+)\}/g, (_, n) => vars[n]) : en),
  }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
vi.mock('@/api/db', () => ({ db: { auth: { updateMe: vi.fn(async () => ({})) } } }));
vi.mock('../WidgetRenderer', () => ({ default: () => null, WIDGET_COMPONENTS: {} }));
vi.mock('../WidgetLibrary', () => ({
  default: ({ open }) => (open ? <div role="dialog" aria-label="Widget library" /> : null),
}));

import DashboardWidgets from '../DashboardWidgets';

const props = { logs: [], goals: [], isLoading: false, userProfile: {} };

describe('DashboardWidgets libraryRequest', () => {
  it('stays closed on a plain mount', () => {
    render(<DashboardWidgets {...props} />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens the library when mounted already asked, as after the tile restores a hidden section', () => {
    render(<DashboardWidgets {...props} libraryRequest={1} />);
    expect(screen.getByRole('dialog', { name: 'Widget library' })).toBeTruthy();
  });

  it('opens the library when the request is bumped on a mounted list', () => {
    const { rerender } = render(<DashboardWidgets {...props} libraryRequest={0} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(<DashboardWidgets {...props} libraryRequest={1} />);
    expect(screen.getByRole('dialog', { name: 'Widget library' })).toBeTruthy();
  });
});
