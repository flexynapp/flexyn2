/**
 * The Cardio section's page header.
 *
 * The header above this section belongs to Workout.jsx. CardioSection tells
 * it what to say by dispatching a `flexyn-title` event; `title: null` hands
 * the header back, and Workout.jsx then supplies the cardio HOME pair
 * ("Cardio" / "Track running, walking, and cycling") itself.
 *
 * The defect this guards: the dispatch keyed off `view.mode` alone, so the
 * five views that carry no mode — Saved, Templates, Planned, Goals, Devices —
 * all sent null and inherited the home header. You tapped "Saved Workouts"
 * and landed on a list of saved sessions titled "Cardio / Track running,
 * walking, and cycling". Before an earlier fix keyed the header off
 * `cardioOpen`, that same null made it read "Today's training / Workout",
 * which is the screenshot this started from.
 *
 * These assert on the EVENT rather than on rendered layout: which string is
 * dispatched is exactly what jsdom can see, and it is the whole mechanism.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

// t() returns the key so an assertion names the key, not a translation that
// a later i18n pass could legitimately reword. tFallback returns its English
// fallback, matching the house stub — EXCEPT for the swimming mode, which is
// marked. The house stub cannot tell a translated string from an English
// literal, because both render as English; the swim title was a hardcoded
// 'Swimming' among three translated siblings in the same 2x2 grid, and only
// a marked return proves it now goes through the translation layer.
const SWIM = 'cardio.modes.swimming';
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    t: (key) => key,
    tFallback: (key, english) => (key === 'cardio.modes.swimming' ? 'XX-swim' : english),
    language: 'en',
  }),
}));
vi.mock('@/lib/AuthContext', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/lib/DistanceUnitContext', () => ({ useDistanceUnit: () => ({ distanceUnit: 'mi' }) }));
vi.mock('@/api/db', () => ({ db: { auth: { me: async () => ({}) }, entities: {} } }));
vi.mock('@/lib/cardioSession', () => ({ readSnapshot: () => null, clearSnapshot: () => {} }));

// The leaf views are irrelevant here — only which title their PARENT sends.
vi.mock('@/components/cardio/CardioManualForm', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioSavedList', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioDetailModal', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioLiveTrackerOutside', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioLiveTrackerIndoor', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioTemplates', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioPlanned', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioWearableStub', () => ({ default: () => <div /> }));
vi.mock('@/components/cardio/CardioGoals', () => ({ default: () => <div /> }));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CardioSection from '@/components/cardio/CardioSection';

let titles;
const record = (e) => titles.push(e.detail?.title ?? null);

function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CardioSection onBack={() => {}} />
    </QueryClientProvider>
  );
}

/** The title in effect right now — the last one dispatched. */
const current = () => titles[titles.length - 1];

/** Tap a tile by its visible label. */
function tap(label) {
  act(() => { fireEvent.click(screen.getByText(label)); });
}

beforeEach(() => {
  titles = [];
  window.addEventListener('flexyn-title', record);
});
afterEach(() => {
  window.removeEventListener('flexyn-title', record);
  cleanup();
});

describe('CardioSection — the header names the view you are on', () => {
  it('hands the header back on the home view, so Workout.jsx supplies the cardio pair', () => {
    mount();
    expect(current()).toBe(null);
  });

  // The five that were broken. Each is the tile label on the cardio home.
  it.each([
    ['cardio.savedWorkouts', 'cardio.savedWorkouts'],
    ['Templates',            'Templates'],
    ['Planned Sessions',     'Planned Sessions'],
    ['Cardio Goals',         'Cardio Goals'],
    ['Devices & Apps',       'Devices & Apps'],
  ])('names itself after tapping %s', (tileLabel, expected) => {
    mount();
    tap(tileLabel);
    expect(current()).toBe(expected);
  });

  it('still names the activity on a mode view', () => {
    mount();
    tap('cardio.modes.running');
    expect(current()).toBe('cardio.modes.running');
  });

  it('sends a translatable Swimming, not an English literal', () => {
    mount();
    // The tile itself already routes through tFallback, so it renders the
    // marker; the header used to send a bare 'Swimming' beside it.
    tap('XX-swim');
    expect(current()).toBe('XX-swim');
    expect(current()).not.toBe('Swimming');
    expect(SWIM).toBe('cardio.modes.swimming');
  });

  it('returns to null when you go back to the home view', () => {
    mount();
    tap('Cardio Goals');
    expect(current()).toBe('Cardio Goals');
    tap('cardio.back');
    expect(current()).toBe(null);
  });
});
