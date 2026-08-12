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
vi.mock('@/hooks/useBodyScrollLock', () => ({ useBodyScrollLock: () => {} }));

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

  // The utility views still reachable from the home. Cardio Goals and
  // Devices & Apps were removed with the redesign (they live in the Goals
  // form and Settings), and Saved Workouts is now reached by SAVING rather
  // than by a tile — its header entry is still covered by the mode tests
  // below, since it is the destination the trackers route to.
  it.each([
    ['Templates',        'Templates'],
    ['Planned Sessions', 'Planned Sessions'],
  ])('names itself after tapping %s', (tileLabel, expected) => {
    mount();
    tap(tileLabel);
    expect(current()).toBe(expected);
  });

  it('still names the activity once the sheet routes you into one', () => {
    mount();
    tap('Start Session');          // the hero
    tap('Running');                // the sheet's activity pill
    tap('Outside');
    tap('cardio.input.manual');
    tap('Log running');
    expect(current()).toBe('cardio.modes.running');
  });

  it('sends a translatable Swimming, not an English literal', () => {
    mount();
    tap('Start Session');
    tap('XX-swim');                // the sheet's swim pill, via tFallback
    tap('Pool');
    tap('Log xx-swim');            // swim is manual-only
    expect(current()).toBe('XX-swim');
    expect(current()).not.toBe('Swimming');
    expect(SWIM).toBe('cardio.modes.swimming');
  });

  it('returns to null when you go back to the home view', () => {
    mount();
    tap('Planned Sessions');
    expect(current()).toBe('Planned Sessions');
    tap('cardio.back');
    expect(current()).toBe(null);
  });
});
