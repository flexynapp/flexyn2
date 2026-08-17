// Inviting somebody to a crew that already exists.
//
// Before this, `buildCrewInviteBody` had exactly one caller — the creation
// wizard — so a crew chose its members in the minute it was founded and could
// never add another by invitation. Anyone later had to find it in the
// directory and apply, including a friend the leader specifically wanted.
//
// What these pin:
//
//   1. People already in the crew are not offered. Inviting an existing
//      member is a wasted RPC and reads as a broken roster.
//   2. Selection is bounded by SEATS LEFT, not a flat number. A crew of 15
//      with a cap of 16 may invite one, and the 16-seat cap is what
//      join_crew_atomic enforces anyway — offering more is a promise the
//      server breaks at the last moment.
//   3. The invite is written BEFORE the DM, the same ordering rule the
//      creation flow has, for the same race.
//   4. A rank refusal (42501) is reported as a rank problem, not folded into
//      a generic count — it means the UI offered a control the server does
//      not honour, which is worth saying out loud.
//   5. Counts read correctly at 1. "1 invites sent" is the kind of thing
//      that survives every test that only checks a toast fired.

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

const inviteToCrew = vi.fn();
vi.mock('@/lib/data/crewMembership', () => ({
  inviteToCrew: (...a) => { calls.push(['invite', a[1]]); return inviteToCrew(...a); },
}));

const sendMessage = vi.fn();
vi.mock('@/lib/data/hubMessages', () => ({
  findOrCreateConversation: async () => ({ id: 'c' }),
  sendMessage: (...a) => { calls.push(['dm', a[0]?.recipientId]); return sendMessage(...a); },
}));

vi.mock('@/lib/data/hubFollows', () => ({
  listFollowingIds: async () => ['f1', 'f2', 'f3'],
}));
vi.mock('@/lib/data/users', () => ({
  list: async () => ([
    { id: 'f1', username: 'ana',   avatar_url: null },
    { id: 'f2', username: 'bruno', avatar_url: null },
    { id: 'f3', username: 'cleo',  avatar_url: null },
  ]),
}));

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { username: 'me' } }) }) }),
    }),
  },
}));

const toastSuccess = vi.fn();
const toastError   = vi.fn();
const toastWarning = vi.fn();
vi.mock('@/lib/toast', () => ({
  toast: Object.assign(vi.fn(), {
    success: (...a) => toastSuccess(...a),
    error:   (...a) => toastError(...a),
    warning: (...a) => toastWarning(...a),
  }),
}));

vi.mock('@/components/ui/BottomSheet', () => ({
  default: ({ open, title, children }) =>
    open ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

const { default: CrewInviteSheet } = await import('../CrewInviteSheet');

function renderSheet(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <CrewInviteSheet
        open onClose={onClose}
        crewId="c1" crewName="Iron Union"
        members={[{ user_id: 'me' }, { user_id: 'f3' }]}
        maxCapacity={16}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onClose };
}

beforeEach(() => {
  calls.length = 0;
  vi.clearAllMocks();
  inviteToCrew.mockResolvedValue({ ok: true });
  sendMessage.mockResolvedValue({});
});

describe('who is offered', () => {
  it('leaves out people already in the crew', async () => {
    renderSheet();
    expect(await screen.findByText('@ana')).toBeTruthy();
    expect(screen.getByText('@bruno')).toBeTruthy();
    // f3 is a member, and `me` is both a member and the viewer.
    expect(screen.queryByText('@cleo')).toBeNull();
    expect(screen.queryByText('@me')).toBeNull();
  });

  it('says so when everyone you follow is already in', async () => {
    renderSheet({ members: [{ user_id: 'me' }, { user_id: 'f1' }, { user_id: 'f2' }, { user_id: 'f3' }] });
    expect(await screen.findByText(/already in this crew/i)).toBeTruthy();
  });
});

describe('seats', () => {
  it('counts the seats actually left, not the cap', async () => {
    // 15 members against a cap of 16 leaves exactly one.
    renderSheet({ members: Array.from({ length: 15 }, (_, i) => ({ user_id: `m${i}` })) });
    expect(await screen.findByText(/Seats left: 1\b/)).toBeTruthy();
  });

  it('refuses a selection past the remaining seats', async () => {
    const user = userEvent.setup();
    renderSheet({ members: Array.from({ length: 15 }, (_, i) => ({ user_id: `m${i}` })) });

    await user.click((await screen.findByText('@ana')).closest('button'));
    await user.click(screen.getByText('@bruno').closest('button'));

    await waitFor(() => expect(toastWarning).toHaveBeenCalled());
    // Reads correctly at 1 — "You can invite 1 more", not "Only 1 seats left".
    expect(toastWarning.mock.calls[0][0]).toBe('You can invite 1 more right now.');
    expect(screen.getByRole('button', { name: 'Send invite' })).toBeTruthy();
  });

  it('tells a full crew it is full', async () => {
    renderSheet({ members: Array.from({ length: 16 }, (_, i) => ({ user_id: `m${i}` })) });
    expect(await screen.findByText(/crew is full/i)).toBeTruthy();
  });
});

describe('sending', () => {
  it('invites before the DM that announces it', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click((await screen.findByText('@ana')).closest('button'));
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(calls.filter(([, who]) => who === 'f1').map(([what]) => what)).toEqual(['invite', 'dm']);
    expect(inviteToCrew).toHaveBeenCalledWith('c1', 'f1');
  });

  it('reads correctly for a single invite', async () => {
    const user = userEvent.setup();
    const { onClose } = renderSheet();
    await user.click((await screen.findByText('@ana')).closest('button'));
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0][0]).toBe('Invite sent.');
    expect(onClose).toHaveBeenCalled();
  });

  it('pluralises past one', async () => {
    const user = userEvent.setup();
    renderSheet();
    await user.click((await screen.findByText('@ana')).closest('button'));
    await user.click(screen.getByText('@bruno').closest('button'));
    await user.click(screen.getByRole('button', { name: 'Send 2 invites' }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(toastSuccess.mock.calls[0][0]).toBe('Invites sent to 2 people.');
  });

  it('names a rank refusal instead of counting it', async () => {
    const user = userEvent.setup();
    inviteToCrew.mockResolvedValue({ ok: false, reason: 'not_allowed' });
    const { onClose } = renderSheet();
    await user.click((await screen.findByText('@ana')).closest('button'));
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/leader or moderator/i);
    // Nothing was sent, so the sheet stays open with the selection intact.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('still sends the DM when the invite row could not be written', async () => {
    const user = userEvent.setup();
    inviteToCrew.mockResolvedValue({ ok: false, reason: 'db_error' });
    renderSheet();
    await user.click((await screen.findByText('@ana')).closest('button'));
    await user.click(screen.getByRole('button', { name: 'Send invite' }));

    await waitFor(() => expect(sendMessage).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/One invite could not be sent/);
  });
});
