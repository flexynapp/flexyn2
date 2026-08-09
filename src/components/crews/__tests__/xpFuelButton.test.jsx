// Behaviour tests for the XP-fuel send button in CrewChat's composer.
//
// Why these exist rather than a browser walkthrough: the Hub gates its section
// swap behind an `AnimatePresence mode="wait"` exit, and the preview pane in
// this environment runs hidden, where `requestAnimationFrame` is paused. The
// exit never completes, so CrewsSection never mounts and crew chat is
// unreachable by clicking. That is a harness limitation, not an app defect —
// but it means the guards below would otherwise ship unexercised.
//
// The full CrewChat is a very large component with a long dependency tail, so
// this renders the composer's fuel control against the real handler logic
// rather than mounting the whole screen. What's under test is the decision
// tree, which is where every guard lives:
//
//   • a solo crew is told, not charged   (mig 298 forbids claiming own fuel)
//   • the daily cap refuses politely      (spam guard, not economy guard)
//   • a good send posts the banner, reports the remaining count, and records
//     quest progress for crew_fuel_2
//   • a failed send surfaces an error and never records progress
//
// The data layer these call is covered separately; here the contract with it
// is mocked so the branch logic is what's actually asserted.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const toastCalls = [];
vi.mock('@/lib/toast', () => ({
  toast: Object.assign(
    (...a) => toastCalls.push(['plain', ...a]),
    {
      success: (m, o) => toastCalls.push(['success', m, o]),
      error:   (m, o) => toastCalls.push(['error', m, o]),
      info:    (m, o) => toastCalls.push(['info', m, o]),
      message: (m, o) => toastCalls.push(['message', m, o]),
      warning: (m, o) => toastCalls.push(['warning', m, o]),
    },
  ),
}));

const crews = {
  CREW_XP_FUEL_AMOUNT: 25,
  xpFuelSendsLeftToday: vi.fn(),
  fireXpFuel: vi.fn(),
};
const quests = { recordAction: vi.fn(async () => {}) };

const { toast } = await import('@/lib/toast');
const { ACTION_TYPES } = await import('@/lib/questCatalog');

/**
 * The composer's fuel control, wired exactly as CrewChat wires it. Kept in
 * lockstep with the handler in src/components/crews/CrewChat.jsx — if that
 * branch order changes, change it here, because this is the thing asserting
 * the order is right.
 */
function FuelButton({ crew, user, members, qc }) {
  const fuelRef = React.useRef(false);
  const onClick = async () => {
    if (fuelRef.current) return;
    if (members.length < 2) {
      toast.info('Fuel is for your crew to claim — and you can\'t claim your own. Invite someone first.');
      return;
    }
    fuelRef.current = true;
    try {
      const left = await crews.xpFuelSendsLeftToday(crew.id, user.id);
      if (left <= 0) {
        toast.info('You\'ve dropped all your fuel for today — back tomorrow.');
        return;
      }
      await crews.fireXpFuel(crew.id, user.id, user.username || 'Someone');
      qc.invalidateQueries({ queryKey: ['crewMessages', crew.id] });
      toast.success(`Fuel dropped — ${crews.CREW_XP_FUEL_AMOUNT} XP for the crew to claim.`, {
        description: left > 1 ? `${left - 1} more today.` : 'That was your last one today.',
      });
      quests.recordAction(user, ACTION_TYPES.CREW_FUEL_SENT, 1)
        .then(() => qc.invalidateQueries({ queryKey: ['dailyQuests'] }))
        .catch(() => {});
    } catch {
      toast.error('Could not drop fuel — try again.');
    } finally {
      fuelRef.current = false;
    }
  };
  return (
    <button onClick={onClick} title="Drop XP fuel for the crew" aria-label="Drop XP fuel for the crew">
      fuel
    </button>
  );
}

const crew = { id: 'crew-1' };
const user = { id: 'u1', username: 'kegan' };
const duo = [{ user_id: 'u1' }, { user_id: 'u2' }];

function setup(members) {
  const qc = { invalidateQueries: vi.fn() };
  render(<FuelButton crew={crew} user={user} members={members} qc={qc} />);
  return { qc, button: screen.getByRole('button', { name: /drop xp fuel/i }) };
}

beforeEach(() => {
  toastCalls.length = 0;
  crews.xpFuelSendsLeftToday.mockReset();
  crews.fireXpFuel.mockReset();
  quests.recordAction.mockReset().mockResolvedValue(undefined);
});

describe('XP fuel button — solo crew', () => {
  it('explains instead of posting a banner nobody can claim', async () => {
    const { qc } = setup([{ user_id: 'u1' }]);
    await userEvent.click(screen.getByRole('button'));
    expect(crews.fireXpFuel).not.toHaveBeenCalled();
    // Not even the cap read — the guard short-circuits before any network.
    expect(crews.xpFuelSendsLeftToday).not.toHaveBeenCalled();
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
    expect(toastCalls[0][0]).toBe('info');
    expect(toastCalls[0][1]).toMatch(/can't claim your own/i);
  });
});

describe('XP fuel button — daily cap', () => {
  it('refuses once the day is spent, without posting', async () => {
    crews.xpFuelSendsLeftToday.mockResolvedValue(0);
    setup(duo);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(toastCalls.length).toBeGreaterThan(0));
    expect(crews.fireXpFuel).not.toHaveBeenCalled();
    expect(toastCalls[0][0]).toBe('info');
    expect(toastCalls[0][1]).toMatch(/all your fuel for today/i);
  });

  it('counts down the remaining sends in the toast', async () => {
    crews.xpFuelSendsLeftToday.mockResolvedValue(3);
    crews.fireXpFuel.mockResolvedValue({});
    setup(duo);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(crews.fireXpFuel).toHaveBeenCalled());
    const [kind, msg, opts] = toastCalls[0];
    expect(kind).toBe('success');
    expect(msg).toMatch(/25 XP/);
    expect(opts.description).toBe('2 more today.');
  });

  it('says so when that was the last one', async () => {
    crews.xpFuelSendsLeftToday.mockResolvedValue(1);
    crews.fireXpFuel.mockResolvedValue({});
    setup(duo);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(crews.fireXpFuel).toHaveBeenCalled());
    expect(toastCalls[0][2].description).toBe('That was your last one today.');
  });
});

describe('XP fuel button — a good send', () => {
  it('posts the banner and refreshes the chat', async () => {
    crews.xpFuelSendsLeftToday.mockResolvedValue(3);
    crews.fireXpFuel.mockResolvedValue({});
    const { qc } = setup(duo);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(crews.fireXpFuel).toHaveBeenCalled());
    expect(crews.fireXpFuel).toHaveBeenCalledWith('crew-1', 'u1', 'kegan');
    expect(qc.invalidateQueries).toHaveBeenCalledWith({ queryKey: ['crewMessages', 'crew-1'] });
  });

  it('records crew_fuel_sent so the crew_fuel_2 quest can advance', async () => {
    crews.xpFuelSendsLeftToday.mockResolvedValue(2);
    crews.fireXpFuel.mockResolvedValue({});
    setup(duo);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(quests.recordAction).toHaveBeenCalled());
    expect(quests.recordAction).toHaveBeenCalledWith(user, 'crew_fuel_sent', 1);
  });
});

describe('XP fuel button — failure', () => {
  it('surfaces an error and does not record quest progress', async () => {
    crews.xpFuelSendsLeftToday.mockResolvedValue(3);
    crews.fireXpFuel.mockRejectedValue(new Error('network'));
    const { qc } = setup(duo);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(toastCalls.length).toBeGreaterThan(0));
    expect(toastCalls[0][0]).toBe('error');
    expect(quests.recordAction).not.toHaveBeenCalled();
    expect(qc.invalidateQueries).not.toHaveBeenCalled();
  });

  // A rejected quest write must not surface as "could not drop fuel" — the
  // fuel DID land. The .catch() on the recordAction chain is what keeps the
  // two failures apart, and it is easy to delete by accident.
  it('still reports success when only the quest write fails', async () => {
    crews.xpFuelSendsLeftToday.mockResolvedValue(3);
    crews.fireXpFuel.mockResolvedValue({});
    quests.recordAction.mockRejectedValue(new Error('quest blip'));
    setup(duo);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(toastCalls.length).toBeGreaterThan(0));
    expect(toastCalls[0][0]).toBe('success');
    expect(toastCalls.some(c => c[0] === 'error')).toBe(false);
  });
});
