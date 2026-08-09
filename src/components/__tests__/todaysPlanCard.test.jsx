import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LanguageProvider } from '@/lib/LanguageContext';
import TodaysPlanCard from '@/components/dashboard/TodaysPlanCard';

// Two regimens minimum — the card renders null without a rotation to infer.
const REGIMENS = [
  {
    id: 'a',
    name: 'Push Day',
    exercises: [
      { name: 'Bench Press', target_sets: 5, target_reps: 5, muscle_groups: ['Chest'] },
      { name: 'Overhead Press', target_sets: 3, target_reps: 8, muscle_groups: ['Shoulders'] },
    ],
  },
  { id: 'b', name: 'Pull Day', exercises: [{ name: 'Barbell Row', target_sets: 4, target_reps: 8 }] },
];

const show = (props = {}) =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <TodaysPlanCard regimens={REGIMENS} logs={[]} {...props} />
      </LanguageProvider>
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("TodaysPlanCard exercise list", () => {
  it('stays a one-line summary until asked — the widget has to stay glanceable', () => {
    show();
    expect(screen.getByText(/2 exercises/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /what's in it/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Bench Press')).toBeNull();
    expect(screen.queryByRole('button', { name: /how to do/i })).toBeNull();
  });

  it('reveals every exercise with its prescription and a how-to guide', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /what's in it/i }));

    expect(screen.getByText('Bench Press')).toBeInTheDocument();
    expect(screen.getByText('Overhead Press')).toBeInTheDocument();
    expect(screen.getByText('5 × 5')).toBeInTheDocument();
    expect(screen.getByText('3 × 8')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /how to do/i })).toHaveLength(2);
  });

  it('opens a guide in place without navigating away', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: /what's in it/i }));
    fireEvent.click(screen.getByRole('button', { name: /how to do bench press/i }));

    // The exercise <ul> plus the guide's own numbered <ol> — the second one
    // appearing is the proof the guide expanded in place.
    expect(screen.getAllByRole('list')).toHaveLength(2);
    expect(screen.getByText(/watch for/i)).toBeInTheDocument();
    // The card's own navigation row is still there — the disclosure is a
    // sibling of that button, not nested inside it (which would be invalid
    // HTML and would swallow every tap into a route change).
    expect(screen.getByText('Push Day', { selector: 'p' })).toBeInTheDocument();
  });

  it('shows no disclosure at all for a regimen with no exercises', () => {
    show({ regimens: [{ id: 'a', name: 'Push Day', exercises: [] }, { id: 'b', name: 'Pull Day', exercises: [] }] });
    expect(screen.queryByRole('button', { name: /what's in it/i })).toBeNull();
  });
});
