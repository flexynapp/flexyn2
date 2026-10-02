import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { POSES } from '@/lib/data/exercisePoses';

const labels = ['Stand tall', 'Hips below knees', 'Drive up'];

describe('ExerciseRepLoop', () => {
  afterEach(() => { vi.doUnmock('@/lib/reducedMotion'); vi.resetModules(); });

  it('plays one figure and names all three positions for screen readers', async () => {
    const { ExerciseRepLoop } = await import('../ExerciseFigure');
    const { container } = render(<ExerciseRepLoop frames={POSES['Bodyweight Squat'].frames} labels={labels} />);
    expect(container.querySelectorAll('svg').length).toBe(1);
    expect(screen.getByText('Stand tall, Hips below knees, Drive up').className).toContain('sr-only');
  });

  it('shows the three stills with Reduce Motion on', async () => {
    vi.resetModules();
    vi.doMock('@/lib/reducedMotion', () => ({ prefersReducedMotion: () => true }));
    const { ExerciseRepLoop } = await import('../ExerciseFigure');
    const { container } = render(<ExerciseRepLoop frames={POSES['Bodyweight Squat'].frames} labels={labels} />);
    expect(container.querySelectorAll('svg').length).toBe(3);
  });

  it('shows the three stills for a press whose elbow flips', async () => {
    const { ExerciseRepLoop } = await import('../ExerciseFigure');
    const { container } = render(<ExerciseRepLoop frames={POSES['Overhead Press'].frames} labels={labels} />);
    expect(container.querySelectorAll('svg').length).toBe(3);
  });
});
