// Tests for src/lib/data/conversationRequests.js — partitions
// conversations into the main inbox vs. the new Message Requests
// folder (migration 113) + wraps the accept_conversation RPC.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const rpcSpy = vi.fn();

// Chainable select mock — acceptPendingRequestsFrom looks the pair's
// conversation up by participant_ids containment through safeSelect.
const _sel = {
  lastTable: null,
  lastColumns: null,
  lastContains: null,
  lastLimit: null,
  nextData: [],
  nextError: null,
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    rpc: (...args) => rpcSpy(...args),
    from: (table) => {
      _sel.lastTable = table;
      const chain = {
        select: (cols) => { _sel.lastColumns = cols; return chain; },
        contains: (col, val) => { _sel.lastContains = { col, val }; return chain; },
        limit: (n) => {
          _sel.lastLimit = n;
          return Promise.resolve({ data: _sel.nextData, error: _sel.nextError });
        },
      };
      return chain;
    },
  },
}));

const {
  acceptConversation,
  purgeMessageRequest,
  unsendMessageRequest,
  isOutgoingPendingRequest,
  acceptPendingRequestsFrom,
  partitionConversations,
  isPendingRequestSendBlocked,
} = await import('../conversationRequests');

beforeEach(() => {
  rpcSpy.mockReset();
  _sel.lastTable = null;
  _sel.lastColumns = null;
  _sel.lastContains = null;
  _sel.lastLimit = null;
  _sel.nextData = [];
  _sel.nextError = null;
});

describe('acceptConversation', () => {
  it('throws when convId is missing', async () => {
    await expect(acceptConversation(null)).rejects.toThrow(/convId/);
  });

  it('calls the accept_conversation RPC with the id', async () => {
    rpcSpy.mockResolvedValueOnce({ error: null });
    await acceptConversation('c1');
    expect(rpcSpy).toHaveBeenCalledWith('accept_conversation', { p_conv_id: 'c1' });
  });

  it('throws when the RPC returns an error', async () => {
    rpcSpy.mockResolvedValueOnce({ error: { code: '42501', message: 'unauthenticated' } });
    await expect(acceptConversation('c1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('partitionConversations', () => {
  const me = 'id-me';

  it('routes a conversation with my acceptance to inbox', () => {
    const { inbox, requests } = partitionConversations(
      [{
        id: 'c1',
        participant_ids: [me, 'id-stranger'],
        accepted_ids: [me],
      }],
      [],
      me,
    );
    expect(inbox).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it('routes a conversation from a follow to inbox even without acceptance', () => {
    const { inbox, requests } = partitionConversations(
      [{
        id: 'c1',
        participant_ids: [me, 'id-friend'],
        accepted_ids: [],
      }],
      ['id-friend'],
      me,
    );
    expect(inbox).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });

  it('does not count following yourself as following the other side', () => {
    const { requests } = partitionConversations(
      [{
        id: 'c1',
        participant_ids: [me, 'id-stranger'],
        accepted_ids: [],
      }],
      [me],
      me,
    );
    expect(requests).toHaveLength(1);
  });

  it('routes a conversation from a stranger (no follow, no accept) to requests', () => {
    const { inbox, requests } = partitionConversations(
      [{
        id: 'c1',
        participant_ids: [me, 'id-stranger'],
        accepted_ids: [],
      }],
      [],
      me,
    );
    expect(inbox).toHaveLength(0);
    expect(requests).toHaveLength(1);
  });

  it('ignores the email columns entirely', () => {
    // Emails are no longer readable; a row that only carries them has no
    // other participant id, so acceptance cannot be inferred from them.
    const { requests } = partitionConversations(
      [{
        id: 'c1',
        participant_emails: ['me@x.com', 'stranger@x.com'],
        accepted_emails: ['me@x.com'],
        participant_ids: [me, 'id-stranger'],
        accepted_ids: [],
      }],
      [],
      me,
    );
    expect(requests).toHaveLength(1);
  });

  it('accepts a Set of followed ids as well as an array', () => {
    const { inbox } = partitionConversations(
      [{
        id: 'c1',
        participant_ids: [me, 'id-friend'],
        accepted_ids: [],
      }],
      new Set(['id-friend']),
      me,
    );
    expect(inbox).toHaveLength(1);
  });

  it('returns the input unchanged when myId is missing', () => {
    const list = [{ id: 'c1' }];
    expect(partitionConversations(list, [], null)).toEqual({ inbox: list, requests: [] });
  });

  it('returns empty arrays for null conversations', () => {
    expect(partitionConversations(null, [], me)).toEqual({ inbox: [], requests: [] });
  });

  it('routes a self-DM / orphaned conversation to inbox, never Requests', () => {
    const { inbox, requests } = partitionConversations(
      [{ id: 'c1', participant_ids: [me], accepted_ids: [] }],
      [],
      me,
    );
    expect(inbox).toHaveLength(1);
    expect(requests).toHaveLength(0);
  });
});

describe('purgeMessageRequest', () => {
  it('throws when convId is missing', async () => {
    await expect(purgeMessageRequest(null)).rejects.toThrow(/convId/);
  });

  it('calls the purge_message_request RPC and reports the delete', async () => {
    rpcSpy.mockResolvedValueOnce({ data: true, error: null });
    const purged = await purgeMessageRequest('c1');
    expect(purged).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith('purge_message_request', { p_conv_id: 'c1' });
  });

  it('returns false when the row was already gone (double-tap)', async () => {
    rpcSpy.mockResolvedValueOnce({ data: false, error: null });
    expect(await purgeMessageRequest('c1')).toBe(false);
  });

  it('propagates the server refusal to purge an accepted conversation', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'conversation_already_accepted' },
    });
    await expect(purgeMessageRequest('c1'))
      .rejects.toMatchObject({ message: 'conversation_already_accepted' });
  });

  it('propagates a non-participant refusal', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'not_a_participant' },
    });
    await expect(purgeMessageRequest('c1')).rejects.toMatchObject({ code: '42501' });
  });
});

describe('unsendMessageRequest', () => {
  it('throws when convId is missing', async () => {
    await expect(unsendMessageRequest(null)).rejects.toThrow(/convId/);
  });

  it('calls the unsend_message_request RPC and reports the delete', async () => {
    rpcSpy.mockResolvedValueOnce({ data: true, error: null });
    const done = await unsendMessageRequest('c1');
    expect(done).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith('unsend_message_request', { p_conv_id: 'c1' });
  });

  it('is a distinct RPC from the recipient-side purge', async () => {
    // purge writes a request block, unsend must not — they can never be
    // the same call.
    rpcSpy.mockResolvedValueOnce({ data: true, error: null });
    await unsendMessageRequest('c1');
    expect(rpcSpy).not.toHaveBeenCalledWith('purge_message_request', expect.anything());
  });

  it('returns false when the row was already gone', async () => {
    rpcSpy.mockResolvedValueOnce({ data: false, error: null });
    expect(await unsendMessageRequest('c1')).toBe(false);
  });

  it('propagates the server refusal on an accepted conversation', async () => {
    rpcSpy.mockResolvedValueOnce({
      data: null,
      error: { code: '42501', message: 'conversation_already_accepted' },
    });
    await expect(unsendMessageRequest('c1'))
      .rejects.toMatchObject({ message: 'conversation_already_accepted' });
  });
});

describe('isOutgoingPendingRequest', () => {
  const me = 'id-me';
  const them = 'id-them';

  it('is true for my own request the recipient has not acted on', () => {
    expect(isOutgoingPendingRequest(
      { participant_ids: [me, them], accepted_ids: [me] }, me
    )).toBe(true);
  });

  it('is false once the recipient accepted', () => {
    expect(isOutgoingPendingRequest(
      { participant_ids: [me, them], accepted_ids: [me, them] }, me
    )).toBe(false);
  });

  it('is false for an INBOUND request I have not accepted', () => {
    // They sent it, so only they are accepted. This is a Requests-tab
    // row — Delete territory, not Unsend.
    expect(isOutgoingPendingRequest(
      { participant_ids: [me, them], accepted_ids: [them] }, me
    )).toBe(false);
  });

  it('does not read the email columns', () => {
    expect(isOutgoingPendingRequest(
      { participant_emails: ['me@x.com', 'them@x.com'], accepted_emails: ['me@x.com'] }, me
    )).toBe(false);
  });

  it('is false for groups, non-pairs, non-participants and missing input', () => {
    expect(isOutgoingPendingRequest(
      { is_group: true, participant_ids: [me, them, 'id-c'], accepted_ids: [me] }, me
    )).toBe(false);
    expect(isOutgoingPendingRequest(
      { participant_ids: [me], accepted_ids: [me] }, me
    )).toBe(false);
    expect(isOutgoingPendingRequest(
      { participant_ids: ['id-a', them], accepted_ids: ['id-a'] }, me
    )).toBe(false);
    expect(isOutgoingPendingRequest(null, me)).toBe(false);
    expect(isOutgoingPendingRequest({ participant_ids: [me, them] }, null)).toBe(false);
  });
});

describe('acceptPendingRequestsFrom', () => {
  const follower = 'id-me';
  const followee = 'id-them';

  it('accepts the pending 1:1 thread, looked up by participant_ids containment', async () => {
    _sel.nextData = [{
      id: 'c1', participant_ids: [followee, follower], accepted_ids: [followee], is_group: false,
    }];
    rpcSpy.mockResolvedValueOnce({ error: null });

    const flipped = await acceptPendingRequestsFrom(follower, followee);

    expect(flipped).toBe(true);
    expect(_sel.lastTable).toBe('hub_conversations');
    expect(_sel.lastContains).toEqual({ col: 'participant_ids', val: [follower, followee] });
    expect(_sel.lastLimit).toBe(20);
    expect(rpcSpy).toHaveBeenCalledWith('accept_conversation', { p_conv_id: 'c1' });
  });

  it('selects only id-keyed columns, never the email columns', async () => {
    _sel.nextData = [];
    await acceptPendingRequestsFrom(follower, followee);
    const cols = String(_sel.lastColumns);
    for (const c of ['id', 'participant_ids', 'accepted_ids', 'is_group']) {
      expect(cols).toContain(c);
    }
    expect(cols).not.toMatch(/email/);
  });

  it('skips group threads and picks the 1:1 conversation', async () => {
    _sel.nextData = [
      { id: 'g1', participant_ids: [follower, followee, 'id-c'], accepted_ids: [followee], is_group: true },
      { id: 'c2', participant_ids: [follower, followee], accepted_ids: [followee], is_group: false },
    ];
    rpcSpy.mockResolvedValueOnce({ error: null });
    expect(await acceptPendingRequestsFrom(follower, followee)).toBe(true);
    expect(rpcSpy).toHaveBeenCalledWith('accept_conversation', { p_conv_id: 'c2' });
  });

  it('ignores a non-group row that is not exactly a pair', async () => {
    _sel.nextData = [
      { id: 'c3', participant_ids: [follower, followee, 'id-c'], accepted_ids: [], is_group: false },
    ];
    expect(await acceptPendingRequestsFrom(follower, followee)).toBe(false);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when the follower already accepted the thread', async () => {
    _sel.nextData = [{
      id: 'c1', participant_ids: [follower, followee], accepted_ids: [followee, follower], is_group: false,
    }];
    const flipped = await acceptPendingRequestsFrom(follower, followee);
    expect(flipped).toBe(false);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('is a no-op when the pair has no conversation', async () => {
    _sel.nextData = [];
    expect(await acceptPendingRequestsFrom(follower, followee)).toBe(false);
    expect(rpcSpy).not.toHaveBeenCalled();
  });

  it('is a no-op for a self-follow or missing ids', async () => {
    expect(await acceptPendingRequestsFrom(follower, follower)).toBe(false);
    expect(await acceptPendingRequestsFrom(null, followee)).toBe(false);
    expect(await acceptPendingRequestsFrom(follower, null)).toBe(false);
    expect(_sel.lastTable).toBeNull();
  });
});

describe('isPendingRequestSendBlocked', () => {
  const me = 'id-me';
  const them = 'id-them';
  const pending = { participant_ids: [me, them], accepted_ids: [me] };

  it('allows the first message into a pending request', () => {
    expect(isPendingRequestSendBlocked(pending, me, 0)).toBe(false);
  });

  it('blocks the second message into a pending request', () => {
    expect(isPendingRequestSendBlocked(pending, me, 1)).toBe(true);
    expect(isPendingRequestSendBlocked(pending, me, 7)).toBe(true);
  });

  it('never blocks once the recipient has accepted', () => {
    const accepted = { participant_ids: [me, them], accepted_ids: [me, them] };
    expect(isPendingRequestSendBlocked(accepted, me, 25)).toBe(false);
  });

  it('never blocks the RECIPIENT of a pending request from replying', () => {
    // `them` sent the request, so only `them` is in accepted_ids.
    // From `me`'s side every other participant has accepted → not gated.
    const inbound = { participant_ids: [me, them], accepted_ids: [them] };
    expect(isPendingRequestSendBlocked(inbound, me, 3)).toBe(false);
  });

  it('exempts group conversations', () => {
    const group = {
      is_group: true,
      participant_ids: [me, them, 'id-c'],
      accepted_ids: [me],
    };
    expect(isPendingRequestSendBlocked(group, me, 9)).toBe(false);
  });

  it('exempts conversations without exactly two participants', () => {
    const odd = { participant_ids: [me], accepted_ids: [] };
    expect(isPendingRequestSendBlocked(odd, me, 9)).toBe(false);
  });

  it('does not read the email columns', () => {
    const emailsOnly = {
      participant_emails: ['me@x.com', 'them@x.com'],
      accepted_emails: ['me@x.com'],
    };
    expect(isPendingRequestSendBlocked(emailsOnly, me, 1)).toBe(false);
  });

  it('returns false for missing inputs', () => {
    expect(isPendingRequestSendBlocked(null, me, 5)).toBe(false);
    expect(isPendingRequestSendBlocked(pending, null, 5)).toBe(false);
  });

  // The cap counts MESSAGE ROWS, never media. A request's single allowed
  // message may carry an image / video / sticker / GIF / voice memo, and
  // an image message uses up that one slot exactly like a text message.
  it('lets the first message carry media', () => {
    expect(isPendingRequestSendBlocked(pending, me, 0)).toBe(false);
  });

  it('counts an image message as the one allowed message', () => {
    // The caller derives myMessageCount from the thread; whether that
    // one row was text or an attachment is irrelevant to the rule.
    expect(isPendingRequestSendBlocked(pending, me, 1)).toBe(true);
  });
});
