/**
 * The four activity tiles on the cardio home each say something different.
 *
 * Three of them used to pass t('cardio.subtitle') — "Track running,
 * walking, and cycling" — so Running, Walking and Biking carried one
 * identical description, which was ALSO the page subtitle rendered a few
 * hundred points above them. Nothing was broken; the screen just told you
 * the same thing four times and told you it under the wrong headings.
 *
 * The assertion that matters is distinctness, not the exact wording —
 * copy should be free to change without breaking a test, but it must not
 * collapse back into one shared string.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cardioI18n } from '@/lib/i18n-cardio';

// t() returns the key, so anything still routed through a SHARED key is
// visible as that key in the output — which is exactly what the bug was.
// tFallback returns its English fallback, matching the house stub.
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key) => key,
    tFallback: (_key, english) => english,
    language: 'en',
  }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'mi' }) }));
vi.mock('@/api/db', () => ({ db: { auth: { me: async () => ({}) }, entities: {} } }));
vi.mock('@/lib/cardioSession', () => ({ readSnapshot: () => null, clearSnapshot: () => {} }));
vi.mock('@/components/cardio/CardioManualForm', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioSavedList', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioDetailModal', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioLiveTrackerOutside', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioLiveTrackerIndoor', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioTemplates', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioPlanned', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioWearableStub', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioGoals', () => ({ default: () => <div /> }));

import CardioSection from '@/components/cardio/CardioSection';

const EN = cardioI18n.en;
const DESC_KEYS = [
  'cardio.modes.running.desc',
  'cardio.modes.walking.desc',
  'cardio.modes.biking.desc',
  'cardio.modes.swimming.desc',
];

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CardioSection onBack={() => {}} />
    </QueryClientProvider>
  );
}

afterEach(cleanup);

describe('the four activity descriptions are distinct', () => {
  it('every description key has English copy', () => {
    for (const k of DESC_KEYS) {
      expect(EN[k], `${k} is missing an English original`).toBeTruthy();
    }
  });

  it('no two of them say the same thing', () => {
    const values = DESC_KEYS.map(k => EN[k]);
    expect(new Set(values).size).toBe(DESC_KEYS.length);
  });

  it('none of them is the page subtitle', () => {
    // The exact defect: three tiles reused cardio.subtitle, the string
    // already rendered as the page's own subtitle.
    for (const k of DESC_KEYS) {
      expect(EN[k]).not.toBe('Track running, walking, and cycling');
    }
  });

  it('renders four different lines under the four tiles', () => {
    mount();
    for (const k of DESC_KEYS) {
      expect(screen.getByText(EN[k]), `${EN[k]} is not on screen`).toBeTruthy();
    }
    // And the shared key is gone from the rendered output entirely. With
    // t() stubbed to return its key, a surviving t('cardio.subtitle')
    // call would put that literal string in the DOM.
    expect(screen.queryByText('cardio.subtitle')).toBeNull();
  });
});
