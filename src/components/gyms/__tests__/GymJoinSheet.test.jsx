// The confirmation sheet between picking a gym and advancing the step.
//
// This is the one place in onboarding that WRITES before the final save,
// which is a deliberate reversal of the step's original design: the
// leaderboard is the payoff and get_gym_consistency_leaderboard is gated
// on membership (mig 158), so it cannot be shown before the join. The
// tests that matter most are therefore about writing exactly once, and
// about undoing it when the user backs out.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const setHomeGym = vi.fn();
const setHomeGymFromOsm = vi.fn();
const setHomeGymCustom = vi.fn();
const getGymConsistencyBoard = vi.fn();
vi.mock('@/lib/data/homeGym', () => ({
  setHomeGym: (...a) => setHomeGym(...a),
  setHomeGymFromOsm: (...a) => setHomeGymFromOsm(...a),
  setHomeGymCustom: (...a) => setHomeGymCustom(...a),
  getGymConsistencyBoard: (...a) => getGymConsistencyBoard(...a),
}));

const leaveGym = vi.fn();
vi.mock('@/lib/data/gymBusinesses', () => ({ leaveGym: (...a) => leaveGym(...a) }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const GymJoinSheet = (await import('../GymJoinSheet')).default;

const DB_PICK = {
  gymId: 'gym-1', name: 'Sanford Springvale YMCA',
  memberCount: 12, distance: 2.1, sub: 'Sanford, ME',
  latitude: 43.44, longitude: -70.78,
};
const OSM_PICK = {
  osm: { osmId: 9001, osmType: 'node', name: 'CrossFit 207', lat: 43.46, lon: -70.75 },
  name: 'CrossFit 207', memberCount: 0, distance: 3.7,
};

const setup = (pick, props = {}) => {
  const onCancel = vi.fn(); const onJoined = vi.fn(); const onContinue = vi.fn();
  render(
    <GymJoinSheet pick={pick} open onCancel={onCancel} onJoined={onJoined}
      onContinue={onContinue} {...props} />,
  );
  return { onCancel, onJoined, onContinue };
};

beforeEach(() => {
  [setHomeGym, setHomeGymFromOsm, setHomeGymCustom, getGymConsistencyBoard, leaveGym]
    .forEach(m => m.mockReset());
  setHomeGym.mockResolvedValue({ ok: true, gymId: 'gym-1' });
  leaveGym.mockResolvedValue({ ok: true });
  getGymConsistencyBoard.mockResolvedValue([]);
});

describe('before joining', () => {
  it('shows the gym and commits nothing', () => {
    setup(DB_PICK);
    expect(screen.getByText('Sanford Springvale YMCA')).toBeTruthy();
    expect(screen.getByText('Join gym')).toBeTruthy();
    // The whole point of the sheet: picking is no longer committing.
    expect(setHomeGym).not.toHaveBeenCalled();
  });

  it('cancels without writing or leaving', async () => {
    const { onCancel } = setup(DB_PICK);
    fireEvent.click(screen.getByText('Cancel'));
    await waitFor(() => expect(onCancel).toHaveBeenCalled());
    expect(setHomeGym).not.toHaveBeenCalled();
    expect(leaveGym).not.toHaveBeenCalled();
  });
});

describe('joining a gym that already has members', () => {
  it('writes once, reports the id, and shows the floor', async () => {
    getGymConsistencyBoard.mockResolvedValue([
      { user_id: 'u1', username: 'kegan', active_days: 5 },
      { user_id: 'u2', username: 'sam', active_days: 3 },
    ]);
    const { onJoined, onContinue } = setup(DB_PICK);

    fireEvent.click(screen.getByText('Join gym'));

    await waitFor(() => expect(screen.getByText('kegan')).toBeTruthy());
    expect(setHomeGym).toHaveBeenCalledTimes(1);
    expect(setHomeGym).toHaveBeenCalledWith('gym-1');
    // The host records the id so handleRevealNext doesn't write again.
    expect(onJoined).toHaveBeenCalledWith('gym-1');
    expect(screen.getByText('sam')).toBeTruthy();

    fireEvent.click(screen.getByText('Continue'));
    expect(onContinue).toHaveBeenCalled();
  });

  it('says so when the floor exists but nobody trained this week', async () => {
    getGymConsistencyBoard.mockResolvedValue([]);
    setup(DB_PICK);
    fireEvent.click(screen.getByText('Join gym'));
    await waitFor(() => expect(screen.getByText(/Nobody here has trained/i)).toBeTruthy());
  });
});

describe('joining as the first member', () => {
  it('skips the board entirely and shows the map instead', async () => {
    setHomeGymFromOsm.mockResolvedValue({ ok: true, gymId: 'gym-new', created: true });
    setup(OSM_PICK);

    fireEvent.click(screen.getByText('Join gym'));

    await waitFor(() => expect(screen.getByText(/first person here/i)).toBeTruthy());
    // `created` means the row did not exist a moment ago, so there is
    // nobody to rank against and no reason to spend the round trip.
    expect(getGymConsistencyBoard).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Map showing CrossFit 207/i)).toBeTruthy();
    // ODbL — the image grid has no attribution control to inherit.
    expect(screen.getByText(/OpenStreetMap contributors/i)).toBeTruthy();
  });

  it('treats an existing but empty gym as first-member too', async () => {
    setup({ ...DB_PICK, memberCount: 0 });
    fireEvent.click(screen.getByText('Join gym'));
    await waitFor(() => expect(screen.getByText(/first person here/i)).toBeTruthy());
    expect(getGymConsistencyBoard).not.toHaveBeenCalled();
  });

  it('falls back to the first-member layout when the board fails to load', async () => {
    getGymConsistencyBoard.mockRejectedValue(new Error('42501'));
    setup(DB_PICK);
    fireEvent.click(screen.getByText('Join gym'));
    // A board that won't load is not a failed join — don't strand the
    // user on a spinner over something already committed.
    await waitFor(() => expect(screen.getByText(/first person here/i)).toBeTruthy());
  });
});

describe('backing out after the write', () => {
  it('leaves the gym rather than just closing the sheet', async () => {
    setup(DB_PICK);
    fireEvent.click(screen.getByText('Join gym'));
    await waitFor(() => expect(screen.getByText('Continue')).toBeTruthy());

    // Cancel is only reachable pre-join in the UI, but the sheet's own
    // dismiss path routes here too — and by then the row exists.
    fireEvent.click(screen.getByLabelText(/close/i));

    await waitFor(() => expect(leaveGym).toHaveBeenCalledWith('gym-1'));
    expect(setHomeGym).toHaveBeenCalledWith(null);
  });
});

describe('a failed join', () => {
  it('surfaces the reason and stays on the confirm step', async () => {
    setHomeGymCustom.mockResolvedValue({ ok: false, error: 'CREATE_LIMIT' });
    const { onJoined } = setup({
      custom: { name: 'My Gym', lat: 43.4, lng: -70.7 }, name: 'My Gym',
    });

    fireEvent.click(screen.getByText('Join gym'));

    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect(screen.getByRole('alert').textContent).toMatch(/added a lot of gyms/i);
    expect(screen.getByText('Join gym')).toBeTruthy();
    expect(onJoined).not.toHaveBeenCalled();
  });
});
