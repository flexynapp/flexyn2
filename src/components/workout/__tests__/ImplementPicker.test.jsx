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
import { render, screen, fireEvent, waitFor } from '@/test/utils';
import ImplementPicker from '../ImplementPicker';
import { LanguageProvider } from '@/lib/LanguageContext';
import { recordImplementUse } from '@/lib/recentImplements';

// The picker fetches the gym floor when the drawer opens. Mock both data
// modules so tests are deterministic — the test env's Supabase URL is a
// stub host, so leaving these real would mean a doomed network round
// trip on every open.
vi.mock('@/lib/data/gymBusinesses', () => ({
  listMyGyms: vi.fn(async () => []),
}));
vi.mock('@/lib/data/gymCheckins', () => ({
  getTodayCheckinGymId: vi.fn(async () => null),
}));
vi.mock('@/lib/data/equipment', () => ({
  listGymFloor: vi.fn(async () => []),
  persistEquipmentPhoto: vi.fn(async () => null),
}));

import { listMyGyms } from '@/lib/data/gymBusinesses';
import { listGymFloor } from '@/lib/data/equipment';
import { getTodayCheckinGymId } from '@/lib/data/gymCheckins';

// jsdom has no matchMedia; BottomSheet reads it for reduced-motion.
beforeEach(() => {
  localStorage.clear();
  // Call history accumulates across tests in a file otherwise, which
  // breaks any assertion on how many times the floor was fetched.
  vi.clearAllMocks();
  listMyGyms.mockResolvedValue([]);
  listGymFloor.mockResolvedValue([]);
  getTodayCheckinGymId.mockResolvedValue(null);
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
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});

describe('the gym floor section', () => {
  const gym = { id: 'gym-1', name: 'Iron Works', owner_id: 'owner-1' };
  const floorRow = {
    id: 'se-1', space_id: 'sp-1', model_id: null,
    implement_type: 'leg_press', label_override: 'Atlantis Leg Press',
    photo_url: null, verified_by_owner: true, added_by: 'owner-1',
    fromOwnerSpace: true,
  };

  it('shows the gym name when the user belongs to exactly one gym', async () => {
    listMyGyms.mockResolvedValue([gym]);
    listGymFloor.mockResolvedValue([floorRow]);
    setup({ exerciseName: 'Leg Press' });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    await waitFor(() => expect(screen.getByText(/At Iron Works/i)).toBeInTheDocument());
    expect(screen.getByText('Atlantis Leg Press')).toBeInTheDocument();
  });

  it('falls back to a generic heading with several gyms', async () => {
    listMyGyms.mockResolvedValue([gym, { id: 'gym-2', name: 'Other', owner_id: 'o2' }]);
    listGymFloor.mockResolvedValue([floorRow]);
    setup({ exerciseName: 'Leg Press' });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    await waitFor(() => expect(screen.getByText(/at your gym/i)).toBeInTheDocument());
  });

  it('only shows floor entries matching this exercise', async () => {
    listMyGyms.mockResolvedValue([gym]);
    listGymFloor.mockResolvedValue([
      floorRow,
      { ...floorRow, id: 'se-2', implement_type: 'lat_pulldown', label_override: 'Cybex Pulldown' },
    ]);
    setup({ exerciseName: 'Leg Press' });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    await waitFor(() => expect(screen.getByText('Atlantis Leg Press')).toBeInTheDocument());
    expect(screen.queryByText('Cybex Pulldown')).toBeNull();
  });

  it('does not duplicate a machine already in your own history', async () => {
    const mine = {
      brand: 'unknown', line: 'Atlantis Leg Press', model: null,
      implementType: 'leg_press', label: 'Atlantis Leg Press',
    };
    recordImplementUse('u1', 'leg_press', mine);
    listMyGyms.mockResolvedValue([gym]);
    listGymFloor.mockResolvedValue([floorRow]);
    setup({ exerciseName: 'Leg Press' });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    await waitFor(() => expect(screen.getByText(/your equipment/i)).toBeInTheDocument());
    expect(screen.getAllByText('Atlantis Leg Press')).toHaveLength(1);
  });

  it('renders no gym section when the user has no gym', async () => {
    listMyGyms.mockResolvedValue([]);
    setup({ exerciseName: 'Leg Press' });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    await waitFor(() => expect(screen.getByText(/common models/i)).toBeInTheDocument());
    expect(screen.queryByText(/at your gym/i)).toBeNull();
  });

  it('scopes to the gym they checked into today', async () => {
    const other = { id: 'gym-2', name: 'Other Gym', owner_id: 'o2' };
    listMyGyms.mockResolvedValue([other, gym]);
    getTodayCheckinGymId.mockResolvedValue('gym-1');
    listGymFloor.mockResolvedValue([floorRow]);
    setup({ exerciseName: 'Leg Press' });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    // Named heading proves it narrowed to one gym, and it's the right one.
    await waitFor(() => expect(screen.getByText(/At Iron Works/i)).toBeInTheDocument());
    expect(listGymFloor).toHaveBeenCalledTimes(1);
    expect(listGymFloor).toHaveBeenCalledWith('gym-1', 'owner-1');
  });

  it('falls back to all gyms when the check-in is one they have not joined', async () => {
    listMyGyms.mockResolvedValue([gym, { id: 'gym-2', name: 'Other', owner_id: 'o2' }]);
    getTodayCheckinGymId.mockResolvedValue('gym-not-a-member-of');
    listGymFloor.mockResolvedValue([floorRow]);
    setup({ exerciseName: 'Leg Press' });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    await waitFor(() => expect(screen.getByText(/at your gym/i)).toBeInTheDocument());
    expect(listGymFloor).toHaveBeenCalledTimes(2);
  });

  it('survives a failing gym lookup without blocking the catalog', async () => {
    listMyGyms.mockRejectedValue(new Error('offline'));
    setup({ exerciseName: 'Leg Press' });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    // The bundled catalog must still be usable — a gym query is never
    // allowed to block someone mid-workout.
    await waitFor(() => expect(screen.getByText(/Super Squat Press/i)).toBeInTheDocument());
  });
});

describe('photos', () => {
  const selected = {
    brand: 'cybex', line: 'Eagle', model: null,
    implementType: 'leg_press', label: 'Cybex Eagle',
  };

  it('offers to add a photo once something is selected', () => {
    setup({ exerciseName: 'Leg Press', value: selected });
    fireEvent.click(screen.getByRole('button', { name: /Cybex Eagle/i }));
    expect(screen.getByText(/add a photo/i)).toBeInTheDocument();
    expect(screen.getByText(/no photo yet/i)).toBeInTheDocument();
  });

  it('switches to replace once a photo exists', () => {
    setup({
      exerciseName: 'Leg Press',
      value: { ...selected, photoUrl: 'https://example.test/leg-press.jpg' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Cybex Eagle/i }));
    expect(screen.getByText(/replace photo/i)).toBeInTheDocument();
    expect(screen.getByText(/your photo/i)).toBeInTheDocument();
  });

  // BottomSheet portals into document.body, so the drawer's contents
  // are outside RTL's `container` — query the document instead.
  it('renders the photo when there is one', () => {
    setup({
      exerciseName: 'Leg Press',
      value: { ...selected, photoUrl: 'https://example.test/leg-press.jpg' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Cybex Eagle/i }));
    expect(
      document.body.querySelector('img[src="https://example.test/leg-press.jpg"]')
    ).toBeTruthy();
  });

  it('falls back to a silhouette with no photo — never an empty box', () => {
    setup({ exerciseName: 'Leg Press', value: selected });
    fireEvent.click(screen.getByRole('button', { name: /Cybex Eagle/i }));
    // Catalog rows have no photos either, so every thumbnail is an svg.
    expect(document.body.querySelectorAll('svg').length).toBeGreaterThan(0);
    expect(document.body.querySelector('img')).toBeNull();
  });

  it('uses the rear camera on mobile', () => {
    setup({ exerciseName: 'Leg Press', value: selected });
    fireEvent.click(screen.getByRole('button', { name: /Cybex Eagle/i }));
    const input = document.body.querySelector('input[type="file"]');
    expect(input).toBeTruthy();
    expect(input.getAttribute('capture')).toBe('environment');
    expect(input.getAttribute('accept')).toBe('image/*');
  });

  it('shows no photo controls before anything is selected', () => {
    setup({ exerciseName: 'Leg Press', value: null });
    fireEvent.click(screen.getByRole('button', { name: /choose equipment/i }));
    expect(screen.queryByText(/add a photo/i)).toBeNull();
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
