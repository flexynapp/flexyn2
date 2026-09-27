/**
 * NextStepRow — one moment from the user's own data, under a page's focal
 * goal. The rules live in src/lib/nextStep.js and are tested there; this
 * covers what the row owns: rendering nothing without a candidate, holding
 * its pick for the visit, dismissal, and analytics that carry the KIND of
 * moment rather than its id (which holds an exercise name and a date).
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const track = vi.fn();
vi.mock('@/lib/analytics', () => ({
  track: (...a) => track(...a),
  EVENTS: { NEXT_STEP_SHOWN: 'next_step_shown', NEXT_STEP_OPENED: 'next_step_opened', NEXT_STEP_DISMISSED: 'next_step_dismissed' },
}));
vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({ tFallback: (k) => `XX:${k}` }),
}));

import NextStepRow from '@/components/glance/NextStepRow';

const Icon = () => <svg data-testid="icon" />;
const cand = (id, extra = {}) => ({
  id, kind: `kind-${id}`, eligible: true, priority: 1, icon: Icon, title: `Title ${id}`, reason: `Reason ${id}`,
  actionLabel: `Act ${id}`, onOpen: vi.fn(), ...extra,
});

beforeEach(() => { localStorage.clear(); track.mockClear(); });
afterEach(cleanup);

describe('NextStepRow', () => {
  it('renders nothing without an eligible candidate', () => {
    const { container } = render(<NextStepRow page="progress" userId="u1" candidates={[cand('a', { eligible: false })]} />);
    expect(container).toBeEmptyDOMElement();
    expect(track).not.toHaveBeenCalled();
  });

  it('renders nothing until ready, then picks', () => {
    const candidates = [cand('a')];
    const { container, rerender } = render(<NextStepRow page="progress" userId="u1" ready={false} candidates={candidates} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<NextStepRow page="progress" userId="u1" ready candidates={candidates} />);
    expect(screen.getByText('Title a')).toBeInTheDocument();
    expect(screen.getByText('Reason a')).toBeInTheDocument();
  });

  it('tracks shown once per visit, with the kind and never the id', () => {
    const candidates = [cand('pr:Bench:2026-09-22')];
    const { rerender } = render(<NextStepRow page="progress" userId="u1" candidates={candidates} />);
    rerender(<NextStepRow page="progress" userId="u1" candidates={[...candidates]} />);
    const shown = track.mock.calls.filter(([e]) => e === 'next_step_shown');
    expect(shown).toEqual([['next_step_shown', { page: 'progress', id: 'kind-pr:Bench:2026-09-22' }]]);
  });

  it('holds the pick for the visit even when a higher candidate appears', () => {
    const { rerender } = render(<NextStepRow page="progress" userId="u1" candidates={[cand('a')]} />);
    rerender(<NextStepRow page="progress" userId="u1" candidates={[cand('a'), cand('b', { priority: 5 })]} />);
    expect(screen.getByText('Title a')).toBeInTheDocument();
    expect(screen.queryByText('Title b')).toBeNull();
  });

  it('the action calls the current handler and tracks it', () => {
    const onOpen = vi.fn();
    render(<NextStepRow page="progress" userId="u1" candidates={[cand('pr', { onOpen })]} />);
    fireEvent.click(screen.getByRole('button', { name: 'Act pr' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('next_step_opened', { page: 'progress', id: 'kind-pr' });
  });

  it('Not now is a labelled 44px icon button that hides the row and records the dismissal', () => {
    render(<NextStepRow page="progress" userId="u1" candidates={[cand('planned')]} />);
    const btn = screen.getByRole('button', { name: 'XX:nextStep.notNow' });
    expect(btn.className).toMatch(/w-11 h-11/);
    fireEvent.click(btn);
    expect(screen.queryByTestId('next-step-row')).toBeNull();
    expect(Object.keys(JSON.parse(localStorage.getItem('flexyn.nextStepDismissed.u1')))).toEqual(['planned']);
    expect(track).toHaveBeenCalledWith('next_step_dismissed', { page: 'progress', id: 'kind-planned' });
  });

  it('a dismissed moment is skipped on the next visit', () => {
    render(<NextStepRow page="progress" userId="u1" candidates={[cand('planned', { priority: 2 }), cand('repeat')]} />);
    fireEvent.click(screen.getByRole('button', { name: 'XX:nextStep.notNow' }));
    cleanup();
    render(<NextStepRow page="progress" userId="u1" candidates={[cand('planned', { priority: 2 }), cand('repeat')]} />);
    expect(screen.getByText('Title repeat')).toBeInTheDocument();
  });
});
