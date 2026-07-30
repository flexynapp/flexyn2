// Render tests for ImplementPicker — the equipment dropdown next to an
// exercise title in an active workout.
//
// The key behaviors under test are the two that would be invisible
// failures in the app: the control must NOT appear on pure bodyweight
// exercises (an empty dropdown is worse than none), and it MUST appear
// on the exercises classifyEquipment gets wrong — Lat Pulldown variants
// above all, which fall to 'other' and would have had no picker at all.

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@/test/utils';
import ImplementPicker from '../ImplementPicker';
import { LanguageProvider } from '@/lib/LanguageContext';
import { recordImplementUse } from '@/lib/recentImplements';

// jsdom has no matchMedia; BottomSheet reads it for reduced-motion.
beforeEach(() => {
  localStorage.clear();
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation(q => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }
});

function setup(props = {}) {
  return render(
    <LanguageProvider>
      <ImplementPicker
        exerciseName="Leg Press"
        value={null}
        onChange={() => {}}
        userId="u1"
        {...props}
      />
    </LanguageProvider>
  );
}

describe('when the picker renders at all', () => {
  it('renders for a machine exercise', () => {
    setup({ exerciseName: 'Leg Press' });
    expect(screen.getByRole('button', { name: /choose equipment/i })).toBeInTheDocument();
  });

  it('renders for Lat Pulldown variants classifyEquipment gets wrong', () => {
    // These fall to 'other' in the coarse classifier. If the override
    // table regresses, the picker silently disappears from the single
    // most-requested machine — so assert it explicitly.
    for (const name of [
      'Close-Grip Lat Pulldown',
      'Lat Pulldown With Neutral Grip',
      'One-Handed Lat Pulldown',
    ]) {
      const { unmount } = setup({ exerciseName: name });
      expect(
        screen.getByRole('button', { name: /choose equipment/i }),
        `expected a picker for "${name}"`
      ).toBeInTheDocument();
      unmount();
    }
  });

  it('renders for assisted machines that classify as bodyweight', () => {
    setup({ exerciseName: 'Assisted Pull-Up' });
    expect(screen.getByRole('button', { name: /choose equipment/i })).toBeInTheDocument();
  });

  it('renders nothing for pure bodyweight work', () => {
    for (const name of ['Push-Up', 'Plank', 'Pull-Up', 'Air Squat']) {
      const { container, unmount } = setup({ exerciseName: name });
      expect(container.innerHTML, `expected no picker for "${name}"`).toBe('');
      unmount();
    }
  });

  it('renders nothing for a missing exercise name', () => {
    const { container } = setup({ exerciseName: '' });
    expect(container.innerHTML).toBe('');
  });
});

describe('trigger label', () => {
  it('prompts when nothing is chosen', () => {
    setup();
    expect(screen.getByText(/add equipment/i)).toBeInTheDocument();
  });

  it('shows the chosen implement', () => {
    setup({ value: { brand: 'cybex', line: 'Eagle', label: 'Cybex Eagle' } });
    expect(screen.getByText('Cybex Eagle')).toBeInTheDocument();
  });
});

describe('choosing an implement', () => {
  it('lists catalog models for the type and reports the pick', () => {
    const onChange = vi.fn();
    setup({ exerciseName: 'Leg Press', onChange });

    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));

    // Seeded plate-loaded leg press should be offered.
    const option = screen.getByText(/Super Squat Press/i);
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledTimes(1);
    const picked = onChange.mock.calls[0][0];
    expect(picked.brand).toBe('hammer_strength');
    expect(picked.implementType).toBe('leg_press');
    expect(picked.label).toMatch(/Super Squat Press/);
  });

  it('remembers the pick for next time', () => {
    const onChange = vi.fn();
    const { unmount } = setup({ exerciseName: 'Leg Press', onChange });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    fireEvent.click(screen.getByText(/Super Squat Press/i));
    unmount();

    // Reopening puts it under "Your equipment".
    setup({ exerciseName: 'Leg Press' });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    expect(screen.getByText(/your equipment/i)).toBeInTheDocument();
  });

  it('surfaces previously used gear ahead of the catalog', () => {
    recordImplementUse('u1', 'leg_press', {
      brand: 'other', line: 'Atlantis Leg Press', model: null,
      implementType: 'leg_press', label: 'Atlantis Leg Press',
    });
    setup({ exerciseName: 'Leg Press' });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    expect(screen.getByText('Atlantis Leg Press')).toBeInTheDocument();
    expect(screen.getByText(/your equipment/i)).toBeInTheDocument();
  });

  it('offers a clear-selection path once something is chosen', () => {
    const onChange = vi.fn();
    setup({
      exerciseName: 'Leg Press',
      value: { brand: 'cybex', line: 'Eagle', label: 'Cybex Eagle' },
      onChange,
    });
    fireEvent.click(screen.getByRole('button', { name: /Cybex Eagle/i }));
    fireEvent.click(screen.getByText(/clear selection/i));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('adding your own', () => {
  it('accepts a custom name the catalog does not cover', () => {
    const onChange = vi.fn();
    setup({ exerciseName: 'Leg Press', onChange });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    fireEvent.click(screen.getByText(/add your own/i));

    const input = screen.getByPlaceholderText(/Atlantis leg press/i);
    fireEvent.change(input, { target: { value: 'Panatta Super Leg Press' } });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(onChange).toHaveBeenCalledTimes(1);
    const picked = onChange.mock.calls[0][0];
    expect(picked.label).toBe('Panatta Super Leg Press');
    expect(picked.brand).toBe('other');
    expect(picked.implementType).toBe('leg_press');
  });

  it('will not save an empty custom name', () => {
    const onChange = vi.fn();
    setup({ exerciseName: 'Leg Press', onChange });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    fireEvent.click(screen.getByText(/add your own/i));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('offers the add path even when the catalog has nothing for the type', () => {
    // Nothing is seeded for the GHD, but a user still has one.
    setup({ exerciseName: 'Glute Ham Raise' });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    expect(screen.getByText(/add your own/i)).toBeInTheDocument();
  });
});
