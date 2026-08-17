// The wiring of invite_to_crew into crew creation.
//
// `crew_invites` had never held a row in production, and that made a DM
// "invite" not an invite at all. join_crew_atomic takes its bypass branch only
// for a live unexpired invite row; every crew is application-gated, so the
// friend a founder hand-picked landed in the review queue behind strangers.
// Verified against production before writing this: private crew with no
// invite returns status 'requested'; the same crew with an invite row returns
// 'joined' and stamps accepted_at; a plain member calling invite_to_crew is
// refused 42501.
//
// What these pin, and why each one is a defect that would be silent:
//
//   1. An invite is created for every selected friend. Without it the whole
//      feature reverts to what it was — indistinguishable from working,
//      because the DM still arrives and the card still says something
//      reasonable.
//   2. The invite is written BEFORE the DM. If the message lands first, a
//      friend who taps Accept immediately files a request instead of joining,
//      and the race is invisible in any test that only checks both were
//      called.
//   3. A failed invite does NOT suppress the DM. The person can still find
//      the crew and apply; dropping the message would strand them entirely.
//   4. A failed DM does NOT suppress the invite, and neither failure aborts
//      creation for the other friends.
//   5. The founder is told when invites failed, because those friends are
//      waiting on a review the founder believes they skipped.

import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const calls = [];

vi.mock('@/lib/LanguageContext', () => ({
  useLanguage: () => ({
    tFallback: (_k, fallback, vars) => {
      let s = fallback;
      if (vars) Object.entries(vars).forEach(([k, v]) => {
        s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      });
      return s;
    },
  }),
}));

vi.mock('@/lib/AuthContext', () => ({
  useAuth: () => ({ user: { id: 'me', email: 'me@example.com' } }),
}));

const createCrew = vi.fn();
const updateCrewProfile = vi.fn();
vi.mock('@/lib/data/crews', () => ({
  createCrew: (...a) => createCrew(...a),
  updateCrewProfile: (...a) => updateCrewProfile(...a),
}));

const inviteToCrew = vi.fn();
vi.mock('@/lib/data/crewMembership', () => ({
  inviteToCrew: (...a) => { calls.push(['invite', a[1]]); return inviteToCrew(...a); },
}));

const sendMessage = vi.fn();
vi.mock('@/lib/data/hubMessages', () => ({
  findOrCreateConversation: async () => ({ id: 'conv1' }),
  sendMessage: (...a) => { calls.push(['dm', a[0]?.recipientId]); return sendMessage(...a); },
}));

vi.mock('@/lib/data/hubFollows', () => ({ listFollowingIds: async () => ['f1', 'f2'] }));
vi.mock('@/lib/data/users', () => ({
  list: async () => ([
    { id: 'f1', username: 'ana',  avatar_url: null },
    { id: 'f2', username: 'bruno', avatar_url: null },
  ]),
}));

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: 'me', avatar_url: null } }) }) }),
    }),
  },
}));

const toastWarning = vi.fn();
const toastError   = vi.fn();
vi.mock('@/lib/toast', () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error:   (...a) => toastError(...a),
    warning: (...a) => toastWarning(...a),
  }),
}));

const { default: CrewCreationFlow } = await import('../CrewCreationFlow');

function renderFlow() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CrewCreationFlow onCreated={() => {}} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

// Pick both friends, name the crew, submit. The rows render `@username`, and
// the selected pill renders the same string, so click the row BUTTON rather
// than the text — after selection there are two nodes reading "@ana".
async function createWithFriends(user) {
  await screen.findByText('@ana');
  await user.click(screen.getByText('@ana').closest('button'));
  await user.click(screen.getByText('@bruno').closest('button'));
  await user.click(screen.getByRole('button', { name: /Next/i }));
  // findBy, not getBy: AnimatePresence mode="wait" holds step 2 back until
  // step 1 has finished exiting, so the input is not in the DOM on the tick
  // after the click.
  await user.type(await screen.findByPlaceholderText(/Morning Grind/i), 'Iron Union');
  await user.click(screen.getByRole('button', { name: /Create Crew/i }));
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  createCrew.mockResolvedValue({ id: 'c1', name: 'Iron Union' });
  inviteToCrew.mockResolvedValue({ ok: true });
  sendMessage.mockResolvedValue({});
});

describe('inviting the friends you picked', () => {
  it('creates a crew_invites row for every selected friend', async () => {
    const user = userEvent.setup();
    renderFlow();
    await createWithFriends(user);

    await waitFor(() => expect(inviteToCrew).toHaveBeenCalledTimes(2));
    expect(inviteToCrew.mock.calls.map(c => c[1]).sort()).toEqual(['f1', 'f2']);
    expect(inviteToCrew.mock.calls[0][0]).toBe('c1');
  });

  it('writes the invite BEFORE the DM that announces it', async () => {
    const user = userEvent.setup();
    renderFlow();
    await createWithFriends(user);

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    // Per friend, the invite must precede the DM. A friend who taps Accept
    // the moment the message lands would otherwise file a request.
    for (const id of ['f1', 'f2']) {
      const mine = calls.filter(([, who]) => who === id).map(([what]) => what);
      expect(mine, `ordering for ${id}`).toEqual(['invite', 'dm']);
    }
  });
});

describe('when one half fails', () => {
  it('still sends the DM when the invite could not be created', async () => {
    const user = userEvent.setup();
    inviteToCrew.mockResolvedValue({ ok: false, reason: 'not_deployed' });
    renderFlow();
    await createWithFriends(user);

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
  });

  it('tells the founder, because those friends now have to apply', async () => {
    const user = userEvent.setup();
    inviteToCrew.mockResolvedValue({ ok: false, reason: 'db_error' });
    renderFlow();
    await createWithFriends(user);

    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    expect(toastWarning.mock.calls[0][0]).toMatch(/2 of your invites/);
  });

  it('says nothing when every invite landed', async () => {
    const user = userEvent.setup();
    renderFlow();
    await createWithFriends(user);

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(toastWarning).not.toHaveBeenCalled();
  });

  it('still invites everyone when a DM throws', async () => {
    const user = userEvent.setup();
    sendMessage.mockRejectedValue(new Error('network'));
    renderFlow();
    await createWithFriends(user);

    await waitFor(() => expect(inviteToCrew).toHaveBeenCalledTimes(2));
    // A failed message is not a failed invite, so no warning about invites.
    expect(toastWarning).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('does not throw the invite rejection out of crew creation', async () => {
    const user = userEvent.setup();
    inviteToCrew.mockRejectedValue(new Error('boom'));
    renderFlow();
    await createWithFriends(user);

    // Creation still completes and the DMs still go.
    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(2));
    expect(toastError).not.toHaveBeenCalled();
  });
});
