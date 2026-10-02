import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/lib/LanguageContext';
import ExerciseFormPanel from '../exercise/ExerciseFormPanel';
import { posesFor } from '@/lib/data/exercisePoses';
import { guideFor } from '@/lib/exerciseGuides';

const show = (name) =>
  render(
    <LanguageProvider>
      <ExerciseFormPanel exerciseName={name} />
    </LanguageProvider>,
  );

afterEach(cleanup);

describe('ExerciseFormPanel', () => {
  it('starts collapsed, so nothing is paid for until asked for', () => {
    show('Bench Press');
    expect(screen.getByRole('button', { name: /how to do bench press/i }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('svg[viewBox="0 0 200 200"]')).toBeNull();
    expect(screen.queryByText(/eyes under the bar/i)).toBeNull();
  });

  it('names the exercise in the control, so a page of them is navigable', () => {
    show('Back Squat');
    expect(screen.getByRole('button', { name: 'How to do Back Squat' })).toBeInTheDocument();
  });

  it('shows written steps and one warning for an exercise with NO drawn pose', async () => {
    // The case that used to render no DOM at all — and `Squat` is the first
    // lift in the default starter plan, so it was the most visible instance.
    expect(posesFor('Squat')).toBeNull();

    show('Squat');
    fireEvent.click(screen.getByRole('button', { name: /how to do squat/i }));

    const steps = guideFor('Squat').steps;
    expect(steps.length).toBeGreaterThan(3);
    for (const step of steps) expect(screen.getByText(step)).toBeInTheDocument();
    expect(screen.getByText(/watch for/i)).toBeInTheDocument();
    // No figure to draw, and no placeholder standing in for one.
    expect(document.querySelector('svg[viewBox="0 0 200 200"]')).toBeNull();
  });

  it('numbers the steps in order', () => {
    show('Deadlift');
    fireEvent.click(screen.getByRole('button', { name: /how to do deadlift/i }));
    const items = document.querySelectorAll('ol li');
    expect(items).toHaveLength(guideFor('Deadlift').steps.length);
    expect(items[0].textContent).toMatch(/^1/);
  });

  it('shows the figure AND the steps when the movement is drawn', async () => {
    show('Bench Press');
    fireEvent.click(screen.getByRole('button', { name: /how to do bench press/i }));

    // Lazy — the geometry and the poses are a separate chunk. One figure
    // plays the rep; the three positions are named once for screen readers.
    await waitFor(() =>
      expect(document.querySelectorAll('svg[viewBox="0 0 200 200"]')).toHaveLength(1),
    );
    expect(screen.getByText(posesFor('Bench Press').labels.join(', '))).toBeInTheDocument();
    for (const step of guideFor('Bench Press').steps) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
  });

  it('hides each figure from screen readers and leaves the caption to speak', async () => {
    show('Back Squat');
    fireEvent.click(screen.getByRole('button', { name: /how to do back squat/i }));
    await waitFor(() =>
      expect(document.querySelectorAll('svg[viewBox="0 0 200 200"]')).toHaveLength(1),
    );
    // role="img" AND aria-hidden together is a contradiction; only the
    // latter is correct here.
    expect(document.querySelectorAll('svg[role="img"]')).toHaveLength(0);
    expect(document.querySelectorAll('svg[viewBox="0 0 200 200"][aria-hidden="true"]'))
      .toHaveLength(1);
  });

  it('renders nothing at all for a name it cannot resolve', () => {
    // A custom exercise the user typed in. Inventing instructions for it is
    // the one failure this whole feature exists to prevent — an empty result
    // is visible and recoverable.
    const { container } = show("Kegan's Special Lift");
    expect(container).toBeEmptyDOMElement();
  });
});

describe('posesFor lookup', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(posesFor('  bench press ')).toBe(posesFor('Bench Press'));
  });

  it('resolves the aliases other parts of the app actually use', () => {
    expect(posesFor('Walking Lunge')).toBe(posesFor('Lunge'));
    expect(posesFor('Bicep Curl')).toBe(posesFor('Dumbbell Curl'));
  });

  it('refuses to guess at movements that merely sound similar', () => {
    // Each of these is a DIFFERENT movement from the nearest drawn one.
    // They now get WORDS from exerciseGuides — but never the wrong picture.
    for (const name of ['Squat', 'Deadlift', 'Chin-up', 'Incline Bench Press', 'Power Clean']) {
      expect(posesFor(name)).toBeNull();
      expect(guideFor(name)).not.toBeNull();
    }
  });

  it('survives the junk a caller can actually pass', () => {
    for (const bad of [null, undefined, '', '   ', 42, {}]) {
      expect(posesFor(bad)).toBeNull();
    }
  });
});
