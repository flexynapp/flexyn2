// Tests for the gym owner's floor editor in GymEdit.
//
// Two behaviours carry real risk and are covered hardest:
//
//   • The optimistic toggle. A pill must respond to the tap rather than
//     to the round trip, but if the write fails the pill has to go back
//     — otherwise the owner believes they removed a machine that is
//     still listed to every member.
//   • Scope. This edits the gym's OWN entries only. If a member's
//     submission ever showed as toggled-on here, untoggling a type the
//     owner never added would silently delete someone else's find.

import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@/test/utils';
import { MemoryRouter } from 'react-router-dom';
import GymEquipmentEditor, { brandToPersist, NO_BRAND } from '../GymEquipmentEditor';
import { LanguageProvider } from '@/lib/LanguageContext';

vi.mock('@/lib/data/equipment', () => ({
  listOwnerFloor: vi.fn(async () => []),
  countPendingMemberEntries: vi.fn(async () => 0),
  addToGymFloor: vi.fn(async () => ({ id: 'new-1' })),
  removeSpaceEquipment: vi.fn(async () => true),
}));

import {
  listOwnerFloor, countPendingMemberEntries, addToGymFloor, removeSpaceEquipment,
} from '@/lib/data/equipment';

beforeEach(() => {
  vi.clearAllMocks();
  listOwnerFloor.mockResolvedValue([]);
  countPendingMemberEntries.mockResolvedValue(0);
  addToGymFloor.mockResolvedValue({ id: 'new-1' });
  removeSpaceEquipment.mockResolvedValue(true);
  if (!window.matchMedia) {
    window.matchMedia = vi.fn().mockImplementation(q => ({
      matches: false, media: q, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
  }
});

function mount(props = {}) {
  return render(
    <MemoryRouter>
      <LanguageProvider>
        <GymEquipmentEditor gymId="gym-1" ownerId="owner-1" {...props} />
      </LanguageProvider>
    </MemoryRouter>
  );
}

const pill = (name) => screen.getByRole('button', { name: new RegExp(`^${name}$`, 'i') });

/** Expand the pill list. It starts collapsed for a gym that already has
 *  equipment listed, so most tests need this first. */
async function expand() {
  const toggle = await screen.findByRole('button', { name: /choose equipment/i });
  fireEvent.click(toggle);
}

describe('rendering', () => {
  it('groups the implement types instead of one flat wall of pills', async () => {
    mount();
    await waitFor(() => expect(screen.getByText('Machines')).toBeInTheDocument());
    for (const g of ['Machines', 'Cables', 'Bars & racks', 'Free weights', 'Cardio']) {
      expect(screen.getByText(g)).toBeInTheDocument();
    }
  });

  it('shows how many types are listed', async () => {
    listOwnerFloor.mockResolvedValue([
      { id: 'a', implement_type: 'leg_press' },
      { id: 'b', implement_type: 'lat_pulldown' },
    ]);
    mount();
    await waitFor(() => expect(screen.getByText(/2 listed/i)).toBeInTheDocument());
  });

  it('marks already-listed types as pressed', async () => {
    listOwnerFloor.mockResolvedValue([{ id: 'a', implement_type: 'leg_press' }]);
    mount();
    await expand();
    await waitFor(() => expect(pill('Leg press')).toHaveAttribute('aria-pressed', 'true'));
    expect(pill('Hack squat')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('toggling a type on', () => {
  it('adds it to the gym floor', async () => {
    mount();
    await waitFor(() => expect(pill('Leg press')).toBeInTheDocument());
    fireEvent.click(pill('Leg press'));
    await waitFor(() => expect(addToGymFloor).toHaveBeenCalledTimes(1));
    const arg = addToGymFloor.mock.calls[0][0];
    expect(arg.gymId).toBe('gym-1');
    expect(arg.userId).toBe('owner-1');
    expect(arg.implement.implementType).toBe('leg_press');
  });

  it('defaults the brand to unknown when no house brand is set', async () => {
    mount();
    await waitFor(() => expect(pill('Leg press')).toBeInTheDocument());
    fireEvent.click(pill('Leg press'));
    await waitFor(() => expect(addToGymFloor).toHaveBeenCalled());
    expect(addToGymFloor.mock.calls[0][0].implement.brand).toBe('unknown');
  });

  it('shows the pill as pressed afterwards', async () => {
    mount();
    await waitFor(() => expect(pill('Leg press')).toBeInTheDocument());
    fireEvent.click(pill('Leg press'));
    await waitFor(() => expect(pill('Leg press')).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('toggling a type off', () => {
  it('removes the owner’s row', async () => {
    listOwnerFloor.mockResolvedValue([{ id: 'row-9', implement_type: 'leg_press' }]);
    mount();
    await expand();
    await waitFor(() => expect(pill('Leg press')).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(pill('Leg press'));
    await waitFor(() => expect(removeSpaceEquipment).toHaveBeenCalledWith('row-9'));
  });

  it('un-presses immediately rather than waiting for the round trip', async () => {
    let release;
    removeSpaceEquipment.mockImplementation(() => new Promise(r => { release = r; }));
    listOwnerFloor.mockResolvedValue([{ id: 'row-9', implement_type: 'leg_press' }]);
    mount();
    await expand();
    await waitFor(() => expect(pill('Leg press')).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(pill('Leg press'));
    // Still in flight, but the UI has already responded.
    await waitFor(() => expect(pill('Leg press')).toHaveAttribute('aria-pressed', 'false'));
    release(true);
  });

  it('puts the pill BACK when the delete fails', async () => {
    // The dangerous case: the owner thinks a machine is delisted when
    // every member can still see it.
    removeSpaceEquipment.mockResolvedValue(false);
    listOwnerFloor.mockResolvedValue([{ id: 'row-9', implement_type: 'leg_press' }]);
    mount();
    await expand();
    await waitFor(() => expect(pill('Leg press')).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(pill('Leg press'));
    await waitFor(() => expect(pill('Leg press')).toHaveAttribute('aria-pressed', 'true'));
  });
});

describe('house brand', () => {
  // MobileSelect renders a Radix Select on desktop widths, and driving
  // that in jsdom means synthesising pointer events — which would test
  // Radix, not this component. The sentinel mapping is the part that can
  // actually be wrong, so it's tested directly instead.
  it('maps the no-brand sentinel onto the catalogue value', () => {
    expect(brandToPersist(NO_BRAND)).toBe('unknown');
    expect(brandToPersist('')).toBe('unknown');
    expect(brandToPersist(undefined)).toBe('unknown');
  });

  it('passes a chosen brand through untouched', () => {
    expect(brandToPersist('hammer_strength')).toBe('hammer_strength');
    expect(brandToPersist('technogym')).toBe('technogym');
  });

  it('never persists the sentinel itself', () => {
    // 'none' reaching the database would be a brand slug nothing renders.
    expect(brandToPersist(NO_BRAND)).not.toBe(NO_BRAND);
  });

  it('does not rewrite entries that already exist', async () => {
    // Changing the house brand is not a bulk edit — that would be a
    // surprising amount of silent rewriting. Nothing should be written
    // until a pill is actually tapped.
    listOwnerFloor.mockResolvedValue([{ id: 'row-9', implement_type: 'leg_press' }]);
    mount();
    await expand();
    await waitFor(() => expect(pill('Leg press')).toBeInTheDocument());
    expect(addToGymFloor).not.toHaveBeenCalled();
    expect(removeSpaceEquipment).not.toHaveBeenCalled();
  });
});

describe('member submissions', () => {
  it('links to the Hub tab when some are awaiting confirmation', async () => {
    countPendingMemberEntries.mockResolvedValue(3);
    mount();
    await waitFor(() => expect(screen.getByText(/3 member submission/i)).toBeInTheDocument());
  });

  it('says nothing when there are none', async () => {
    countPendingMemberEntries.mockResolvedValue(0);
    mount();
    await waitFor(() => expect(screen.getByText('Machines')).toBeInTheDocument());
    expect(screen.queryByText(/member submission/i)).toBeNull();
  });

  it('never shows a member entry as one of the owner’s pills', async () => {
    // listOwnerFloor is owner-scoped by design; this pins the contract so
    // a future refactor to listGymFloor would fail loudly here.
    listOwnerFloor.mockResolvedValue([]);
    countPendingMemberEntries.mockResolvedValue(5);
    mount();
    await waitFor(() => expect(screen.getByText(/5 member submission/i)).toBeInTheDocument());
    expect(pill('Leg press')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('collapsing', () => {
  it('starts OPEN for a gym with nothing listed', async () => {
    // That owner is exactly who needs to see the list, and an empty
    // section behind a closed disclosure reads as "nothing here".
    listOwnerFloor.mockResolvedValue([]);
    mount();
    await waitFor(() => expect(screen.getByText('Machines')).toBeInTheDocument());
  });

  it('starts CLOSED once equipment is listed', async () => {
    // 57 pills is ~1600px, and this sits below three other editors.
    listOwnerFloor.mockResolvedValue([{ id: 'a', implement_type: 'leg_press' }]);
    mount();
    await waitFor(() => expect(screen.getByText(/1 listed/i)).toBeInTheDocument());
    expect(screen.queryByText('Machines')).toBeNull();
  });

  it('still shows the count and the pending link while collapsed', async () => {
    // The summary has to carry enough that an owner knows the state
    // without opening it.
    listOwnerFloor.mockResolvedValue([{ id: 'a', implement_type: 'leg_press' }]);
    countPendingMemberEntries.mockResolvedValue(2);
    mount();
    await waitFor(() => expect(screen.getByText(/1 listed/i)).toBeInTheDocument());
    expect(screen.getByText(/2 member submission/i)).toBeInTheDocument();
  });
});
