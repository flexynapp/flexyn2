import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/lib/LanguageContext';
import ExerciseFormPanel from '../exercise/ExerciseFormPanel';
import { posesFor } from '@/lib/data/exercisePoses';

const show = (name) =>
  render(
    <LanguageProvider>
      <ExerciseFormPanel exerciseName={name} />
    </LanguageProvider>,
  );

afterEach(cleanup);

describe('ExerciseFormPanel', () => {
  it('renders nothing at all for an exercise with no pose', () => {
    const { container } = show('Sumo Deadlift');
    // Not "an empty panel" — no DOM. A card that grows a disabled row for
    // every undrawn movement is worse than one that stays as it was.
    expect(container).toBeEmptyDOMElement();
  });

  it('starts collapsed, so the figure costs nothing until asked for', () => {
    show('Bench Press');
    expect(screen.getByRole('button', { name: /how to do bench press/i }))
      .toHaveAttribute('aria-expanded', 'false');
    expect(document.querySelector('svg[viewBox="0 0 200 200"]')).toBeNull();
  });

  it('reveals the three frames with their cues on tap', async () => {
    show('Bench Press');
    fireEvent.click(screen.getByRole('button', { name: /how to do bench press/i }));

    // Lazy — the geometry and 117 poses are a separate chunk.
    await waitFor(() =>
      expect(document.querySelectorAll('svg[viewBox="0 0 200 200"]')).toHaveLength(3),
    );
    for (const cue of posesFor('Bench Press').labels) {
      expect(screen.getByText(cue)).toBeInTheDocument();
    }
  });

  it('names the exercise in the control, so a page of them is navigable', () => {
    show('Back Squat');
    expect(screen.getByRole('button', { name: 'How to do Back Squat' })).toBeInTheDocument();
  });

  it('hides each figure from screen readers and leaves the caption to speak', async () => {
    show('Back Squat');
    fireEvent.click(screen.getByRole('button', { name: /how to do back squat/i }));
    await waitFor(() =>
      expect(document.querySelectorAll('svg[viewBox="0 0 200 200"]')).toHaveLength(3),
    );
    // role="img" AND aria-hidden together is a contradiction; only the
    // latter is correct here.
    expect(document.querySelectorAll('svg[role="img"]')).toHaveLength(0);
    expect(document.querySelectorAll('svg[viewBox="0 0 200 200"][aria-hidden="true"]'))
      .toHaveLength(3);
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
    // Showing nothing is recoverable; showing the wrong lift is not.
    for (const name of ['Squat', 'Deadlift', 'Chin-up', 'Incline Bench Press', 'Power Clean']) {
      expect(posesFor(name)).toBeNull();
    }
  });

  it('survives the junk a caller can actually pass', () => {
    for (const bad of [null, undefined, '', '   ', 42, {}]) {
      expect(posesFor(bad)).toBeNull();
    }
  });
});
