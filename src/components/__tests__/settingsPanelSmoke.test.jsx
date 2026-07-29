// TEMP repro harness — renders SettingsPanel with everything stubbed to
// surface a render-time throw that shows up in the app as a blank Settings menu.

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
  db: { auth: { me: vi.fn(async () => ({ id: 'me', email: 'me@x.com', notification_prefs: {} })), updateMe: vi.fn() } },
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

const { default: SettingsPanel } = await import('../SettingsPanel');

describe('SettingsPanel', () => {
  it('renders without throwing', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    const { container } = render(
      React.createElement(MemoryRouter, null,
        React.createElement(QueryClientProvider, { client: qc },
          React.createElement(SettingsPanel)))
    );
    expect(container.textContent.length).toBeGreaterThan(0);
  });
});
