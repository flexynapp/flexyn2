// Mount smoke test for every Settings subpage.
//
// Settings is reached two taps deep and each subpage pulls in ~20 modules,
// so a render-time throw in one shows up to users as "that settings page is
// blank" and nothing else — no error, no toast. This test mounts all seven
// with every dependency stubbed and asserts each produces output.
//
// It replaces settingsPanelSmoke.test.jsx, which covered the single
// 1,585-line SettingsPanel this was split out of. The split is exactly why
// the test has to be per-section now: mounting one page no longer proves
// the other six even parse.

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: { id: 'me', email: 'me@x.com' } }) }));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en', t: (k) => k, tFallback: (_k, fb) => fb, setLanguage: vi.fn(),
    currentLanguage: { code: 'en', flag: '🇺🇸', label: 'English', nativeLabel: 'English' },
    SUPPORTED_LANGUAGES: [{ code: 'en', flag: '🇺🇸', label: 'English', nativeLabel: 'English' }],
  }),
}));
vi.mock('@/lib/WeightUnitContext', () => ({ useWeightUnit: () => ({ weightUnit: 'lbs', setWeightUnit: vi.fn() }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'mi', setDistanceUnit: vi.fn() }) }));
vi.mock('@/lib/ThemeContext', () => ({ useTheme: () => ({ darkMode: false, setDarkMode: vi.fn() }) }));
vi.mock('@/lib/SettingsContext', () => ({
  useSettings: () => ({
    enableNotifications: true, setEnableNotifications: vi.fn(),
    enableWorkoutReminders: true, setEnableWorkoutReminders: vi.fn(),
    cardioAutoPause: true, setCardioAutoPause: vi.fn(),
    restTimerEnabled: true, setRestTimerEnabled: vi.fn(),
    levelAnimationsEnabled: true, setLevelAnimationsEnabled: vi.fn(),
    nutrientRingView: false, setNutrientRingView: vi.fn(),
    calorieCyclingEnabled: false, setCalorieCyclingEnabled: vi.fn(),
  }),
}));
vi.mock('@/lib/usePushSubscription', () => ({
  usePushSubscription: () => ({
    isSupported: true, isSubscribed: false, isLoading: false, permission: 'default',
    subscribe: vi.fn(), unsubscribe: vi.fn(),
  }),
}));
vi.mock('@/api/db', () => ({
  db: {
    auth: {
      me: vi.fn(async () => ({ id: 'me', email: 'me@x.com', notification_prefs: {} })),
      updateMe: vi.fn(),
      patchCache: vi.fn(),
    },
  },
}));
vi.mock('@/api/supabaseClient', () => ({
  supabase: { from: () => ({ update: () => ({ eq: async () => ({ error: null }) }) }), rpc: async () => ({ error: null }) },
}));
vi.mock('@/lib/data/quietHours', () => ({
  getMyQuietHours: vi.fn(async () => ({ start: null, end: null })),
  setMyQuietHours: vi.fn(async () => ({ ok: true })),
  formatHour12: (h) => `${h}:00`,
}));
vi.mock('@/lib/data/hubReports', () => ({ listMyReports: vi.fn(async () => []) }));
vi.mock('@/lib/data/userBlocks', () => ({ listBlocks: vi.fn(async () => []), unblockUserFull: vi.fn() }));
vi.mock('@/lib/data/userMutes', () => ({ listMutes: vi.fn(async () => []), unmuteUser: vi.fn() }));
vi.mock('@/lib/data/dmRequestBlocks', () => ({ listMyRequestBlocks: vi.fn(async () => []), removeRequestBlock: vi.fn() }));
vi.mock('@/lib/data/storyPrivacy', () => ({
  getStoryBlocks: vi.fn(async () => []), blockUser: vi.fn(), unblockUser: vi.fn(), updateDefaultStoryPrivacy: vi.fn(),
}));
vi.mock('@/lib/data/stories', () => ({ updateStoryDmsSettings: vi.fn() }));
vi.mock('@/lib/data/gymRival', () => ({ setGymRivalOptOut: vi.fn() }));
vi.mock('framer-motion', () => ({
  AnimatePresence: ({ children }) => children,
  motion: new Proxy({}, {
    get: () => ({ children, ...p }) => {
      const { initial, animate, exit, transition, whileTap, whileHover, layout, ...rest } = p;
      return React.createElement('div', rest, children);
    },
  }),
}));

const SECTIONS = {
  PreferencesSection:   (await import('../settings/PreferencesSection')).default,
  NotificationsSection: (await import('../settings/NotificationsSection')).default,
  TrainingSection:      (await import('../settings/TrainingSection')).default,
  BodySection:          (await import('../settings/BodySection')).default,
  PrivacySection:       (await import('../settings/PrivacySection')).default,
  AccountSection:       (await import('../settings/AccountSection')).default,
  AboutSection:         (await import('../settings/AboutSection')).default,
};

const mount = (Component) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    React.createElement(MemoryRouter, null,
      React.createElement(QueryClientProvider, { client: qc },
        React.createElement(Component)))
  );
};

describe('Settings sections', () => {
  for (const [name, Component] of Object.entries(SECTIONS)) {
    it(`${name} renders without throwing`, () => {
      const { container } = mount(Component);
      expect(container.textContent.length).toBeGreaterThan(0);
    });
  }

  // Every toggle in here is a `role="switch"` button whose hit area must
  // clear 44px — the whole reason Settings got its own route. `min-h-11` is
  // the class that guarantees it, so assert on the class rather than on a
  // computed height jsdom won't lay out.
  it('gives every switch a 44px row', () => {
    const { container } = mount(SECTIONS.PreferencesSection);
    const switches = container.querySelectorAll('[role="switch"]');
    expect(switches.length).toBeGreaterThan(0);
    for (const el of switches) {
      expect(el.className).toMatch(/min-h-11|h-11/);
    }
  });
});
