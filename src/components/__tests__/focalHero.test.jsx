/**
 * Hero option D on Progress and Nutrition: the focal ring, its haptic, and
 * the empty states. The sentence rules are tested in focalGoal.test.js;
 * this covers what only a render can show: no zero where there is no data,
 * no ring against a target nobody chose, the haptic firing on ADVANCE only,
 * and every translated string arriving with its vars.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const haptic = vi.fn();
vi.mock('@/lib/haptic', () => ({ triggerHaptic: (...a) => haptic(...a) }));
vi.mock('@/lib/analytics', () => ({ track: vi.fn(), EVENTS: {} }));
// Interpolating stub that IGNORES the English fallback: a missing var
// renders as a literal {placeholder} and fails the no-brace assertions.
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    tFallback: (k, _en, vars = {}) => `[${k}${Object.keys(vars).length ? ' ' + Object.keys(vars).sort().map((v) => `${v}=${vars[v]}`).join(' ') : ''}]`,
  }),
}));
vi.mock('@/hooks/useNutritionTargets', () => ({
  useNutritionTargets: () => ({ calories: 2000, protein_g: 150 }),
}));

import FocalRing from '@/components/glance/FocalRing';
import ProgressFocal from '@/components/progress/ProgressFocal';
import NutritionFocal from '@/components/nutrition/NutritionFocal';

const THU = new Date(2026, 8, 24, 18);
const lift = (date, weight = 100, reps = 5) => ({ id: date, date, exercises: [{ name: 'Bench', sets: [{ weight, reps }] }] });
const profile = { training_days: ['0', '2', '4', '5'], total_xp: 900 };

beforeEach(() => { haptic.mockClear(); localStorage.clear(); });
afterEach(cleanup);

const text = () => document.body.textContent;

describe('FocalRing', () => {
  it('buzzes when the value advances after mount, never on mount or on a drop', () => {
    const { rerender } = render(<FocalRing share={0.25} advance={1} />);
    expect(haptic).not.toHaveBeenCalled();
    rerender(<FocalRing share={0.5} advance={2} />);
    expect(haptic).toHaveBeenCalledTimes(1);
    expect(haptic).toHaveBeenCalledWith('success');
    rerender(<FocalRing share={0.25} advance={1} />);
    expect(haptic).toHaveBeenCalledTimes(1);
  });

  it('draws no arc without a target or at zero', () => {
    const { rerender } = render(<FocalRing share={null} />);
    expect(screen.queryByTestId('focal-ring-arc')).toBeNull();
    rerender(<FocalRing share={0} />);
    expect(screen.queryByTestId('focal-ring-arc')).toBeNull();
    rerender(<FocalRing share={0.5} />);
    expect(screen.getByTestId('focal-ring-arc')).toBeInTheDocument();
  });
});

describe('ProgressFocal', () => {
  it('mid week: 2 of 4, the sentence, the dots and the stat row', () => {
    render(<ProgressFocal now={THU} userProfile={profile} weightUnit="lbs"
      logs={[lift('2026-09-24', 110), lift('2026-09-22', 105), lift('2026-09-10', 100)]} />);
    expect(screen.getByRole('img', { name: /progress\.focal\.ring\.aria done=2 target=4/ })).toBeInTheDocument();
    expect(screen.getByTestId('focal-headline').textContent).toBe('[progress.focal.week.more n=2]');
    expect(text()).toContain('[progress.focal.week.trainedOn days=Tuesday and Thursday]');
    expect(screen.getAllByRole('listitem')).toHaveLength(7);
    expect(text()).toContain('[progress.glance.level n=');
    expect(text()).toContain('[progress.glance.volume unit=lbs]');
    expect(text()).toContain('[progress.glance.prs]');
    // The fresh PR is the next step, with its day named.
    expect(text()).toContain('[progress.next.pr.titleToday detail=110\u00A0lbs\u00A0×\u00A05 exercise=Bench]');
    expect(text()).not.toMatch(/\{\w+\}/);
  });

  it('brand new user: the goal in the ring, no zero, no stat row, no next step, one Start', () => {
    const onStart = vi.fn();
    render(<ProgressFocal now={THU} userProfile={{ ...profile, total_xp: 0 }} logs={[]} onStart={onStart} />);
    expect(screen.queryByTestId('glance-stat-row')).toBeNull();
    screen.getByRole('button', { name: '[progress.focal.start]' }).click();
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('focal-headline').textContent).toBe('[progress.focal.week.first]');
    expect(text()).toContain('[progress.focal.week.planned_other n=4]');
    expect(text()).toContain('[progress.focal.ring.perWeek]');
    expect(screen.queryByTestId('focal-ring-arc')).toBeNull();
    expect(text()).not.toContain('progress.glance.volume');
    expect(text()).not.toContain('progress.glance.prs');
    expect(screen.queryByTestId('next-step-row')).toBeNull();
    expect(text()).not.toMatch(/(^|[^\d])0\/4/);
  });

  it('unknown target: the count with no ring at all', () => {
    render(<ProgressFocal now={THU} userProfile={{}} logs={[lift('2026-09-22')]} />);
    expect(screen.queryByRole('img', { name: /ring/ })).toBeNull();
    expect(screen.getByTestId('focal-headline').textContent).toBe('[progress.focal.week.count_one]');
  });

  it('a planned day with no session yet offers Start', () => {
    // Friday (index 4) is planned; last session was Tuesday.
    const fri = new Date(2026, 8, 25, 9);
    render(<ProgressFocal now={fri} userProfile={profile} logs={[{ id: 'x', date: '2026-09-22', exercises: [] }]} />);
    expect(text()).toContain('[progress.next.planned.title]');
  });
});

describe('NutritionFocal', () => {
  it('nothing logged: an honest prompt, no kcal figure, no stat row', () => {
    render(<NutritionFocal entries={[]} userProfile={{}} onLogMeal={() => {}} />);
    expect(screen.getByTestId('focal-headline').textContent).toBe('[nutrition.focal.empty]');
    expect(text()).toContain('[nutrition.focal.emptyDetail n=2,000]');
    expect(screen.getByRole('button', { name: '[nutrition.focal.logMeal]' })).toBeInTheDocument();
    expect(screen.queryByTestId('glance-stat-row')).toBeNull();
    expect(text()).not.toMatch(/\b0\b/);
  });

  it('water alone does not count as a meal, but shows in the row', () => {
    render(<NutritionFocal entries={[{ food_name: 'Water|16', calories: 0 }]} userProfile={{}} />);
    expect(screen.getByTestId('focal-headline').textContent).toBe('[nutrition.focal.empty]');
    expect(text()).toContain('[nutrition.glance.water]');
    expect(text()).not.toContain('[nutrition.glance.protein]');
  });

  it('meals logged: kcal in the ring, what is left, protein beside it', () => {
    render(<NutritionFocal entries={[{ food_name: 'Oats', meal_type: 'breakfast', calories: 1240, protein: 60 }]} userProfile={{}} />);
    expect(screen.getByRole('img', { name: '[nutrition.focal.ring.aria n=1,240 target=2,000]' })).toBeInTheDocument();
    expect(screen.getByTestId('focal-headline').textContent).toBe('[nutrition.focal.left n=760]');
    expect(text()).toContain('[nutrition.focal.meals_one]');
    expect(text()).toContain('[nutrition.glance.protein]');
    expect(screen.queryByRole('button', { name: '[nutrition.focal.logMeal]' })).toBeNull();
  });
});
