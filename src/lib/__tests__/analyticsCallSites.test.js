// Every event the app declares must be sent from somewhere.
//
// Until 2026-09-26, six of the fifteen events in EVENTS (workout_logged,
// meal_logged, water_logged, cardio_logged, goal_created, post_created)
// were declared and never sent. Nothing failed: track() of an
// unused name costs nothing and an unsent event raises nothing. It only
// showed once PostHog was switched on and a retention question ("did the
// person who signed up yesterday log a workout?") had no data behind it.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EVENTS } from '@/lib/analytics';

function sources(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (name === '__tests__' || name === 'i18n-langs') continue;
    if (fs.statSync(p).isDirectory()) sources(p, out);
    else if (/\.(jsx?|tsx?)$/.test(name)) out.push(fs.readFileSync(p, 'utf8'));
  }
  return out;
}

describe('analytics events', () => {
  const code = sources(path.resolve(__dirname, '../..')).join('\n');

  it.each(Object.keys(EVENTS))('%s is sent from somewhere', (key) => {
    expect(code.includes(`EVENTS.${key}`)).toBe(true);
  });
});

// Each logged thing is counted once, by the screen that knows its details.
// The old data client also sent a bare copy of workout_logged,
// cardio_logged, meal_logged, water_logged, goal_created and post_created
// from inside every insert, so each of those events counted double in
// PostHog from 2026-09-26 until this was removed.
describe('analytics are not sent from the database client', () => {
  it('src/api/db.js does not import analytics', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../../api/db.js'), 'utf8');
    expect(src).not.toMatch(/@\/lib\/analytics/);
  });

  it('a live session saved as a workout is still counted', () => {
    // The one workout save with no tracking of its own; it relied on the
    // copy the client sent.
    const src = fs.readFileSync(path.resolve(__dirname, '../../components/hub/LiveSessionBroadcaster.jsx'), 'utf8');
    expect(src).toMatch(/track\(EVENTS\.WORKOUT_LOGGED/);
  });
});
