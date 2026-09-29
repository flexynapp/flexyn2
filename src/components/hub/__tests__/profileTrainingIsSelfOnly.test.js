/**
 * Every other athlete's profile once announced "Trained 0 of the last 7 days".
 *
 * `workout_logs` carries exactly one policy — `created_by =
 * current_user_email() OR user_id = auth.uid()` — so filtering it by another
 * user's id returns [] rather than an error, and anything derived from that
 * empty list (a week strip, a streak, a workout count, recent sessions)
 * reads as "did nothing" about a person the viewer simply has no data on.
 *
 * The profile summary (2026-09-29) derives your streak, workout count, best
 * lift and recent workouts from your own logs, and uses the server's
 * `workout_streak` for everyone else. These scans guard the call sites.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REL = 'src/components/hub/HubProfile.jsx';
const src = readFileSync(resolve(process.cwd(), REL), 'utf8');

describe('HubProfile training data is self only', () => {
  it('does not read workout_logs for somebody else', () => {
    const q = src.match(/queryKey: \['profileLifts'[\s\S]{0,600}?\}\);/);
    expect(q, 'the profileLifts query must still exist').toBeTruthy();
    expect(q[0]).toMatch(/enabled:\s*isSelf\s*&&/);
  });

  it('takes another athlete\'s streak from the server, not from an empty log list', () => {
    expect(src).toMatch(/const scoreStreak = isSelf \? trainingStreak : \(Number\(targetProfile\?\.workout_streak\) \|\| 0\);/);
  });

  it('shows the workouts row and recent workouts only on your own profile', () => {
    expect(src).toMatch(/\{isSelf && heroLogs\.length > 0 && \(\s*<SummaryRow/);
    expect(src).toMatch(/\{isSelf && <ProfileRecentWorkouts logs=\{heroLogs\}/);
  });
});
