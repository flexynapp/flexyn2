// The card a Coach answer is drawn as. Rendered with a template-interpolating
// translator (not `(k, en) => en`) so a label that loses its vars shows up as
// a literal "{n}" here, the way it would in Spanish.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    language: 'en',
    tFallback: (_k, fb, vars) =>
      vars ? Object.entries(vars).reduce((s, [n, v]) => s.replaceAll(`{${n}}`, v), fb) : fb,
  }),
}));

import CoachAnswerCard from '../coach/CoachAnswerCard';

const card = {
  tone: 'wait',
  headline: 'Log a squat first, then add 5 to 10 lb.',
  points: [
    { text: 'No leg sets in 14 days', viz: { type: 'muscle_sets', muscle: 'legs', sets: 0 } },
    { text: 'Add weight once every rep lands twice', viz: null },
    { text: 'You trained 1 day of 3', viz: { type: 'week_sessions', done: 1, target: 3 } },
    { text: 'Readiness is 93', viz: { type: 'readiness', score: 93 } },
    { text: 'One logged day at 648 kcal', viz: { type: 'calories', kcal: 648, days: 1 } },
  ],
  next: 'Log your next squat with weight and reps.',
};

describe('CoachAnswerCard', () => {
  it('draws the headline, each point with its figure, and the next step', () => {
    const { container } = render(<CoachAnswerCard card={card} animate={false} />);
    expect(screen.getByText(card.headline)).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Not yet' })).toBeTruthy();
    expect(screen.getByText('legs, 14 days')).toBeTruthy();
    expect(screen.getByText('/3')).toBeTruthy();
    expect(screen.getByText('93')).toBeTruthy();
    expect(screen.getByText('648')).toBeTruthy();
    expect(screen.getByText('1 of 7 days')).toBeTruthy();
    expect(screen.getByText(card.next)).toBeTruthy();
    expect(container.textContent).not.toMatch(/\{\w+\}/);
  });

  it('cleans dashes the model slipped into a field', () => {
    render(<CoachAnswerCard card={{ ...card, points: [], headline: 'Rest today — train tomorrow' }} animate={false} />);
    expect(screen.getByText('Rest today. Train tomorrow')).toBeTruthy();
  });
});
