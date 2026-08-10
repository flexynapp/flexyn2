import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import WeeklyDebriefCard from '../WeeklyDebriefCard';

// The card's whole design premise is that A SECTION WITH NO DATA IS NOT
// RENDERED — never as zeros, never as em dashes. That rule is the thing most
// likely to break silently, because the failure looks like a working screen
// with a "0" on it rather than like an error.
//
// It also matters more than it sounds: production holds three workout logs in
// total, so almost every real user hits the PARTIAL-data paths rather than the
// full one. The partial paths are the common case, not the edge case.
//
// These tests cover the gating matrix and the three regressions that were
// found by hand during the rebuild: the league row hidden by a NULL rank, the
// macro bar drawn at zero width, and stat rows rendering a column of dashes.

const full = {
  week_label: 'Week 32, 2026',
  week_number: 32,
  year: 2026,
  data: {
    schema_version: 2,
    week_start: '2026-08-03',
    week_end: '2026-08-09',
    ai_insight: 'Volume ran 1.1x your four-week normal.',
    training: {
      sessions: 4, days_trained: 4, day_flags: [true, false, true, true, false, true, false],
      volume_lbs: 18450, prev_lbs: 16480, change_pct: 12, baseline_lbs: 16400,
      load_ratio: 1.13, sets: 312, reps: 1284, duration_min: 220,
      muscle_sets: { Back: 16, Chest: 14, Legs: 12, Core: 4 },
      pr_count: 2, streak: 12,
      top_lift: { name: 'Bench Press', weight: 225, reps: 5, is_pr: true },
    },
    conditioning: { sessions: 3, distance_m: 19956, duration_min: 112, calories: 640, steps: 58200, steps_days: 7 },
    fuel: { days_logged: 6, avg_calories: 2340, avg_protein: 186, avg_carbs: 240, avg_fat: 78 },
    recovery: { sleep_nights: 5, sleep_hours: 7.2, sleep_quality: 4.1, soreness: 2.3,
                mood_days: 5, mood_avg: 4.2, weight_start: 185, weight_end: 184.2, weight_change: -0.8 },
    game: { xp_earned: 1840, level_start: 12, level_end: 13, quests_done: 18, coins: 1250, trophy_count: 2 },
    people: { crew_name: 'Iron Age Barbell', crew_messages: 9, duels_played: 3, duels_won: 2,
              league_tier: 'Gold', league_rank: 4, league_xp: 1840, league_days: 5 },
  },
};

/** Deep-merge a patch into the full payload's `data`. */
const withData = (patch) => ({ ...full, data: { ...full.data, ...patch } });

const heading = (name) => screen.queryByRole('heading', { name });

describe('WeeklyReviewCard — a full week', () => {
  it('renders every section when every signal has data', () => {
    render(<WeeklyDebriefCard debrief={full} />);
    for (const s of ['Load', 'Balance', 'Progression', 'Conditioning', 'Fuel', 'Recovery', 'The game', 'Your people']) {
      expect(heading(s), `expected the "${s}" section`).toBeInTheDocument();
    }
  });

  it('shows the headline figures', () => {
    render(<WeeklyDebriefCard debrief={full} />);
    expect(screen.getByText('18,450')).toBeInTheDocument();   // volume
    expect(screen.getByText('1,840')).toBeInTheDocument();    // XP, from the ledger
    expect(screen.getByText('2,340')).toBeInTheDocument();    // kcal/day
    expect(screen.getByText('of 7 days')).toBeInTheDocument(); // the hero unit
    expect(screen.getByText('day streak')).toBeInTheDocument();
  });

  it('renders a seven-cell day strip', () => {
    const { container } = render(<WeeklyDebriefCard debrief={full} />);
    expect(container.querySelectorAll('.grid-cols-7 > div')).toHaveLength(7);
  });

  it('orders muscle groups heaviest first — the list IS the balance read', () => {
    render(<WeeklyDebriefCard debrief={full} />);
    const labels = ['Back', 'Chest', 'Legs', 'Core'];
    const ys = labels.map(l => screen.getByText(l).compareDocumentPosition(screen.getByText('Core')));
    // Back/Chest/Legs all precede Core (DOCUMENT_POSITION_FOLLOWING = 4)
    expect(ys.slice(0, 3).every(v => v & 4)).toBe(true);
  });

  it('marks a PR on the top lift', () => {
    render(<WeeklyDebriefCard debrief={full} />);
    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByText('New PR')).toBeInTheDocument();
  });

  it('keeps exactly ONE 32px seam — the single break CLAUDE.md allows', () => {
    const { container } = render(<WeeklyDebriefCard debrief={full} />);
    expect(container.querySelectorAll('.pt-8')).toHaveLength(1);
  });
});

describe('WeeklyReviewCard — sections omit rather than render zeros', () => {
  it('a rest week shows "You rested" and hides every training section', () => {
    const rest = withData({
      training: { sessions: 0, days_trained: 0, day_flags: [false,false,false,false,false,false,false],
                  volume_lbs: 0, muscle_sets: {}, top_lift: { name: null } },
      conditioning: { sessions: 0, steps: 0 },
      fuel: { days_logged: 0 },
      recovery: { sleep_nights: 0, mood_days: 0 },
      people: {},
    });
    render(<WeeklyDebriefCard debrief={rest} />);
    expect(screen.getByText('You rested')).toBeInTheDocument();
    for (const s of ['Load', 'Balance', 'Progression', 'Conditioning', 'Fuel', 'Recovery', 'Your people']) {
      expect(heading(s), `"${s}" must not render on an empty week`).not.toBeInTheDocument();
    }
  });

  it('always renders The game — XP exists for every account', () => {
    const rest = withData({ training: { sessions: 0 }, conditioning: {}, fuel: {}, recovery: {}, people: {} });
    render(<WeeklyDebriefCard debrief={rest} />);
    expect(heading('The game')).toBeInTheDocument();
  });

  it('never prints a bare 0 for a signal the user did not log', () => {
    const rest = withData({ conditioning: { sessions: 0, steps: 0 }, fuel: { days_logged: 0 } });
    render(<WeeklyDebriefCard debrief={rest} />);
    expect(screen.queryByText('0 kcal / day')).not.toBeInTheDocument();
    expect(screen.queryByText(/0 steps/)).not.toBeInTheDocument();
  });

  it('drops a stat with nothing behind it instead of rendering an em dash', () => {
    // sleep logged, but quality and soreness are optional and unset — they are
    // NULL on 6 of 7 and 7 of 7 production rows respectively.
    const partial = withData({ recovery: { sleep_nights: 3, sleep_hours: 7.0, sleep_quality: null, soreness: null } });
    const { container } = render(<WeeklyDebriefCard debrief={partial} />);
    expect(screen.getByText('avg sleep')).toBeInTheDocument();
    expect(screen.queryByText('sleep quality')).not.toBeInTheDocument();
    expect(screen.queryByText('soreness')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('—');
  });
});

describe('WeeklyReviewCard — regressions found during the rebuild', () => {
  it('shows the league while it is still running, when rank is NULL', () => {
    // league_members.rank is only written when the league RESOLVES, and is
    // NULL on all 42 production rows. Gating the row on it hid the league for
    // the entire week the user was competing in — the only week it matters.
    const running = withData({
      people: { league_tier: 'Bronze', league_rank: null, league_xp: 15, league_days: 2 },
    });
    render(<WeeklyDebriefCard debrief={running} />);
    expect(heading('Your people')).toBeInTheDocument();
    expect(screen.getByText('Bronze league')).toBeInTheDocument();
    expect(screen.getByText(/15 weekly XP/)).toBeInTheDocument();
  });

  it('hides the macro bar when calories were logged without macros', () => {
    // protein is set on 6 of 120 production nutrition_logs rows: quick-add
    // captures calories only. Without the gate this drew a zero-width bar
    // over three "0 g" labels, which reads as a rendering failure.
    const caloriesOnly = withData({
      fuel: { days_logged: 5, avg_calories: 2100, avg_protein: 0, avg_carbs: 0, avg_fat: 0 },
    });
    render(<WeeklyDebriefCard debrief={caloriesOnly} />);
    expect(screen.getByText('2,100')).toBeInTheDocument();
    expect(screen.getByText('Calories logged without macros this week.')).toBeInTheDocument();
    expect(screen.queryByText('Protein')).not.toBeInTheDocument();
  });

  it('renders a v1 payload from the flat keys', () => {
    // Rows generated before migration 328 have no sectioned objects. They must
    // still render rather than blanking.
    const v1 = {
      week_label: 'Week 21, 2026',
      data: {
        volume_lbs: 18450, workouts_count: 4, workout_streak: 3,
        top_lift_name: 'Squat', top_lift_weight: 315, top_lift_reps: 3, top_lift_is_pr: false,
        xp_earned: 291, level_end: 7, ai_insight: 'Legacy week.',
      },
    };
    render(<WeeklyDebriefCard debrief={v1} />);
    expect(screen.getByText('18,450')).toBeInTheDocument();
    expect(screen.getByText('Squat')).toBeInTheDocument();
    expect(screen.getByText('291')).toBeInTheDocument();
    expect(screen.getByText('Legacy week.')).toBeInTheDocument();
  });

  it('renders nothing at all without a debrief', () => {
    const { container } = render(<WeeklyDebriefCard debrief={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('WeeklyReviewCard — steps', () => {
  const withSteps = (over) => withData({
    conditioning: {
      sessions: 0, steps: 21000, steps_days: 3,
      daily_steps: [9000, 0, 7000, 0, 5000, 0, 0], prev_steps: 14000, ...over,
    },
  });

  it('leads with the daily average, not the total', () => {
    render(<WeeklyDebriefCard debrief={withSteps()} />);
    // 21,000 over 3 logged days = 7,000/day. The average is the headline.
    expect(screen.getByText('7,000')).toBeInTheDocument();
    expect(screen.getByText('steps / day')).toBeInTheDocument();
    // the total is demoted to the caption, not gone
    expect(screen.getByText(/21,000 total/)).toBeInTheDocument();
  });

  it('divides by days LOGGED, not by seven', () => {
    // Manual entry means a missing day is "not recorded", not "did not move".
    // Dividing by 7 here would report 3,000 and understate every honest week.
    render(<WeeklyDebriefCard debrief={withSteps()} />);
    expect(screen.queryByText('3,000')).not.toBeInTheDocument();
  });

  it('draws seven daily bars and distinguishes a zero day from a small one', () => {
    const { container } = render(<WeeklyDebriefCard debrief={withSteps()} />);
    const bars = container.querySelectorAll('.h-7 > div');
    expect(bars).toHaveLength(7);
    // tallest day is the 9,000; unlogged days fall back to the flat track
    expect(bars[0].className).toContain('bg-primary');
    expect(bars[1].className).toContain('bg-secondary');
  });

  // Load carries its own "vs last week" chip, so these assertions are scoped to
  // the Conditioning section — a bare screen query matches the wrong one.
  const conditioning = () =>
    within(screen.getByRole('heading', { name: 'Conditioning' }).closest('section'));

  it('compares against last week only when there is a baseline', () => {
    render(<WeeklyDebriefCard debrief={withSteps()} />);
    expect(conditioning().getByText(/50% vs last week/)).toBeInTheDocument();  // 21k vs 14k
  });

  it('says nothing about last week when last week had no steps', () => {
    render(<WeeklyDebriefCard debrief={withSteps({ prev_steps: 0 })} />);
    expect(conditioning().queryByText(/vs last week/)).not.toBeInTheDocument();
  });

  it('omits the bar chart on a v1 payload that has no daily_steps', () => {
    const { container } = render(
      <WeeklyDebriefCard debrief={withSteps({ daily_steps: undefined })} />);
    expect(container.querySelectorAll('.h-7 > div')).toHaveLength(0);
    expect(screen.getByText('steps / day')).toBeInTheDocument();  // the rest still renders
  });
});
