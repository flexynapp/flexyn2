import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── db.entities mock ────────────────────────────────────────────────────────
// listMessages goes through db.entities.HubMessage.filter(...). We capture the
// args the data layer passes and hand back whatever the test stages.
const _msgState = {
  lastFilterConditions: null,
  lastFilterSort: null,
  lastFilterLimit: null,
  filterReturn: [],
  createCalls: [],
  createReturn: { id: 'msg-1' },
};

// sendMessage reads the signed-in user's display identity out of the
// profile cache to stamp sender_name / sender_avatar — the columns
// notify_dm_received builds the recipient's notification from.
const _profileState = { profile: null };
vi.mock('@/api/profileCache', () => ({
  getProfile: () => _profileState.profile,
}));

// findOrCreateConversation goes through db.entities.HubConversation.
// `filterByConditions` lets a test stage a different result per lookup
// shape ({ id: … } after the RPC vs { participant_key: … } on the
// pre-migration fallback path).
const _convState = {
  filterCalls: [],
  filterByConditions: null, // (conditions) => rows
  filterReturn: [],
  createCalls: [],
  createReturn: { id: 'legacy-conv' },
};

// The statements ownedRows sends are proven identical to the old client's
// in ownedRowsEquivalence.test.js; here each table's rows are faked.
vi.mock('@/lib/data/ownedRows', () => {
  const byTable = {
    hub_messages: {
      filter: vi.fn(async (conditions, sort, limit) => {
        _msgState.lastFilterConditions = conditions;
        _msgState.lastFilterSort = sort;
        _msgState.lastFilterLimit = limit;
        return _msgState.filterReturn;
      }),
      create: vi.fn(async (payload) => {
        _msgState.createCalls.push(payload);
        return { ..._msgState.createReturn, ...payload };
      }),
      update: vi.fn(async () => ({})),
    },
    hub_conversations: {
      filter: vi.fn(async (conditions) => {
        _convState.filterCalls.push(conditions);
        if (_convState.filterByConditions) {
          return _convState.filterByConditions(conditions) ?? [];
        }
        return _convState.filterReturn;
      }),
      create: vi.fn(async (payload) => {
        _convState.createCalls.push(payload);
        return _convState.createReturn;
      }),
      update: vi.fn(async () => ({})),
    },
  };
  return { ownedRows: (table) => byTable[table] };
});

// ── supabase mock ───────────────────────────────────────────────────────────
// listOlderMessages uses the client directly to express the `< created_date`
// cursor bound. Capture the chain calls so we can assert the query shape.
const _sbState = {
  lastTable: null,
  lastSelect: null,
  lastEq: null,
  lastLt: null,
  lastOrder: null,
  lastLimit: null,
  nextData: [],
  nextError: null,
  lastRpc: null,
  rpcCalls: [],
  rpcByName: {},
  rpcReturn: { data: null, error: null },
};

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => {
      _sbState.lastTable = table;
      const chain = {
        select: (cols) => { _sbState.lastSelect = cols; return chain; },
        eq: (col, val) => { _sbState.lastEq = { col, val }; return chain; },
        lt: (col, val) => { _sbState.lastLt = { col, val }; return chain; },
        order: (col, opts) => { _sbState.lastOrder = { col, opts }; return chain; },
        limit: (n) => {
          _sbState.lastLimit = n;
          return Promise.resolve({ data: _sbState.nextData, error: _sbState.nextError });
        },
      };
      return chain;
    },
    rpc: vi.fn(async (name, args) => {
      _sbState.lastRpc = { name, args };
      _sbState.rpcCalls.push({ name, args });
      if (Object.prototype.hasOwnProperty.call(_sbState.rpcByName, name)) {
        return _sbState.rpcByName[name];
      }
      return _sbState.rpcReturn;
    }),
  },
}));

vi.mock('@/lib/dmPolls', () => ({ isPollVote: () => false }));
vi.mock('@/lib/reportError', () => ({ reportError: vi.fn() }));

const hubMessages = await import('../hubMessages');

beforeEach(() => {
  _msgState.lastFilterConditions = null;
  _msgState.lastFilterSort = null;
  _msgState.lastFilterLimit = null;
  _msgState.filterReturn = [];
  _msgState.createCalls = [];
  _msgState.createReturn = { id: 'msg-1' };
  _profileState.profile = null;
  _sbState.lastTable = null;
  _sbState.lastSelect = null;
  _sbState.lastEq = null;
  _sbState.lastLt = null;
  _sbState.lastOrder = null;
  _sbState.lastLimit = null;
  _sbState.nextData = [];
  _sbState.nextError = null;
  _sbState.lastRpc = null;
  _sbState.rpcCalls = [];
  _sbState.rpcByName = {};
  _sbState.rpcReturn = { data: null, error: null };
  _convState.filterCalls = [];
  _convState.filterByConditions = null;
  _convState.filterReturn = [];
  _convState.createCalls = [];
  _convState.createReturn = { id: 'legacy-conv' };
  localStorage.clear();
});

describe('findOrCreateConversation', () => {
  const me = 'me@x.com';
  const them = 'them@x.com';

  it('creates through the start_dm_conversation RPC and returns that row', async () => {
    _sbState.rpcByName.start_dm_conversation = { data: 'conv-99', error: null };
    _convState.filterByConditions = (conditions) =>
      (conditions.id === 'conv-99'
        ? [{ id: 'conv-99', participant_emails: [me, them], accepted_emails: [me] }]
        : []);

    const row = await hubMessages.findOrCreateConversation(me, them);

    expect(row).toMatchObject({ id: 'conv-99' });
    // Only the PEER is sent — caller identity is resolved server-side.
    expect(_sbState.rpcCalls.find(c => c.name === 'start_dm_conversation').args)
      .toEqual({ p_other_email: them });
    // The RPC is idempotent, so no client-side insert should happen.
    expect(_convState.createCalls).toHaveLength(0);
  });

  it('lower-cases the peer email before handing it to the RPC', async () => {
    _sbState.rpcByName.start_dm_conversation = { data: 'conv-99', error: null };
    _convState.filterByConditions = () => [{ id: 'conv-99' }];

    await hubMessages.findOrCreateConversation('Me@X.com', 'THEM@X.com');

    expect(_sbState.rpcCalls.find(c => c.name === 'start_dm_conversation').args)
      .toEqual({ p_other_email: them });
  });

  it('falls back to the legacy client insert when the RPC is missing (42883)', async () => {
    _sbState.rpcByName.start_dm_conversation = {
      data: null,
      error: { code: '42883', message: 'function does not exist' },
    };
    _convState.filterByConditions = () => []; // nothing exists yet

    const row = await hubMessages.findOrCreateConversation(me, them);

    expect(row).toMatchObject({ id: 'legacy-conv' });
    expect(_convState.createCalls).toHaveLength(1);
    expect(_convState.createCalls[0].participant_emails).toEqual([me, them]);
  });

  it('does NOT fall back to a client insert when the RPC refuses', async () => {
    // The request-block gate lives inside start_dm_conversation. If a
    // refusal fell through to the legacy find-then-insert path, a
    // blocked sender could create the conversation anyway — the whole
    // point of the gate. Anything other than "function not deployed"
    // has to propagate.
    _sbState.rpcByName.start_dm_conversation = {
      data: null,
      error: { code: '42501', message: 'conversation_unavailable' },
    };
    _convState.filterByConditions = () => [];

    await expect(hubMessages.findOrCreateConversation(me, them))
      .rejects.toMatchObject({ message: 'conversation_unavailable' });
    expect(_convState.createCalls).toHaveLength(0);
  });

  it('returns null for a self-DM without touching the RPC', async () => {
    const row = await hubMessages.findOrCreateConversation(me, 'ME@x.com');
    expect(row).toBeNull();
    expect(_sbState.rpcCalls).toHaveLength(0);
  });
});

describe('listMessages', () => {
  it('fetches newest-first then returns ascending (oldest-first) for render', async () => {
    // DB returns newest-first (what the -created_date query yields).
    _msgState.filterReturn = [
      { id: 'c', created_date: '2026-06-10T03:00:00Z' },
      { id: 'b', created_date: '2026-06-10T02:00:00Z' },
      { id: 'a', created_date: '2026-06-10T01:00:00Z' },
    ];
    const rows = await hubMessages.listMessages('conv-1', 200);
    expect(_msgState.lastFilterConditions).toEqual({ conversation_id: 'conv-1' });
    expect(_msgState.lastFilterSort).toBe('-created_date');
    expect(_msgState.lastFilterLimit).toBe(200);
    // Reversed → oldest-first.
    expect(rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('does not mutate the array the entity layer returned', async () => {
    const original = [
      { id: 'b', created_date: '2026-06-10T02:00:00Z' },
      { id: 'a', created_date: '2026-06-10T01:00:00Z' },
    ];
    _msgState.filterReturn = original;
    await hubMessages.listMessages('conv-1');
    expect(original.map(r => r.id)).toEqual(['b', 'a']); // untouched
  });

  it('returns [] for a missing conversation id', async () => {
    expect(await hubMessages.listMessages(null)).toEqual([]);
  });
});

describe('listOlderMessages', () => {
  it('queries strictly-older rows, newest-first, and reverses to ascending', async () => {
    _sbState.nextData = [
      { id: 'z', created_date: '2026-06-10T00:50:00Z' },
      { id: 'y', created_date: '2026-06-10T00:40:00Z' },
      { id: 'x', created_date: '2026-06-10T00:30:00Z' },
    ];
    const rows = await hubMessages.listOlderMessages('conv-1', '2026-06-10T01:00:00Z', 100);
    expect(_sbState.lastTable).toBe('hub_messages');
    expect(_sbState.lastEq).toEqual({ col: 'conversation_id', val: 'conv-1' });
    expect(_sbState.lastLt).toEqual({ col: 'created_date', val: '2026-06-10T01:00:00Z' });
    expect(_sbState.lastOrder).toEqual({ col: 'created_date', opts: { ascending: false } });
    expect(_sbState.lastLimit).toBe(100);
    // Reversed → oldest-first so it can be prepended.
    expect(rows.map(r => r.id)).toEqual(['x', 'y', 'z']);
  });

  it('returns [] when no cursor is supplied (no history paged)', async () => {
    const rows = await hubMessages.listOlderMessages('conv-1', null);
    expect(rows).toEqual([]);
    expect(_sbState.lastTable).toBeNull(); // never hit the DB
  });

  it('returns [] and reports on error rather than throwing', async () => {
    _sbState.nextError = { message: 'rls denied' };
    _sbState.nextData = null;
    const rows = await hubMessages.listOlderMessages('conv-1', '2026-06-10T01:00:00Z');
    expect(rows).toEqual([]);
  });
});

describe('markRead', () => {
  // The read-receipt opt-out (mig 238) is enforced INSIDE
  // mark_message_read, which reads the flag from user_profiles keyed on
  // auth.uid(). The client must therefore keep calling the RPC
  // unconditionally — if it ever started gating the call on a local
  // setting, that would be the client asserting its own preference,
  // which is exactly the bypass the server-side check exists to
  // prevent. This test pins that the client stays dumb here.
  it('always calls mark_message_read and never passes a receipts flag', async () => {
    _msgState.filterReturn = [
      { id: 'm1', conversation_id: 'c1', sender_email: 'other@x.com', read_at: null },
    ];
    _sbState.rpcByName.mark_message_read = { data: null, error: null };

    await hubMessages.markRead('c1', 'me@x.com');

    const call = _sbState.rpcCalls.find(c => c.name === 'mark_message_read');
    expect(call).toBeTruthy();
    expect(call.args).toEqual({ p_message_id: 'm1' });
  });

  it('clears the local unread marker even when the server skips the stamp', async () => {
    // Receipts-off users still need their OWN unread badge to clear.
    // markRead writes the per-device marker before the RPC, so a
    // server-side no-op cannot leave the reader stuck at unread.
    _msgState.filterReturn = [];
    await hubMessages.markRead('conv-xyz', 'me@x.com');
    expect(localStorage.getItem('fn-conv-read-conv-xyz')).toBeTruthy();
  });
});

describe('unreadCountFor', () => {
  it('uses the dm_unread_count RPC and passes localStorage last-reads', async () => {
    localStorage.setItem('fn-conv-read-conv-abc', '1752500000000');
    localStorage.setItem('unrelated-key', '123');
    _sbState.rpcReturn = { data: 7, error: null };

    const count = await hubMessages.unreadCountFor('me@x.com');

    expect(count).toBe(7);
    expect(_sbState.lastRpc.name).toBe('dm_unread_count');
    expect(_sbState.lastRpc.args).toEqual({
      p_last_reads: { 'conv-abc': 1752500000000 },
    });
    // RPC path never pulls message rows
    expect(_msgState.lastFilterLimit).toBeNull();
  });

  it('falls back to the legacy window count when the RPC is missing (42883)', async () => {
    _sbState.rpcReturn = { data: null, error: { code: '42883', message: 'function does not exist' } };
    _msgState.filterReturn = [
      { id: 'm1', conversation_id: 'c1', sender_email: 'other@x.com', read_at: null, created_date: '2026-07-15T00:00:00Z' },
      { id: 'm2', conversation_id: 'c1', sender_email: 'me@x.com',    read_at: null, created_date: '2026-07-15T00:01:00Z' },
      { id: 'm3', conversation_id: 'c2', sender_email: 'other@x.com', read_at: '2026-07-15T00:02:00Z', created_date: '2026-07-15T00:00:30Z' },
    ];

    const count = await hubMessages.unreadCountFor('me@x.com');

    // m1 only: m2 is my own, m3 is read
    expect(count).toBe(1);
    expect(_msgState.lastFilterLimit).toBe(400);
  });

  it('returns 0 without any call when email is missing', async () => {
    const count = await hubMessages.unreadCountFor(null);
    expect(count).toBe(0);
    expect(_sbState.lastRpc).toBeNull();
  });
});

describe('sendMessage — sender identity for notifications', () => {
  const base = {
    conversationId: 'conv-1',
    senderEmail: 'me@x.com',
    body: 'hey',
  };

  it('stamps sender_name + sender_avatar from the profile cache', async () => {
    _profileState.profile = {
      username: 'liftheavy',
      avatar_url: 'https://cdn.example/a.png',
    };
    await hubMessages.sendMessage(base);
    const payload = _msgState.createCalls[0];
    expect(payload.sender_name).toBe('liftheavy');
    expect(payload.sender_avatar).toBe('https://cdn.example/a.png');
  });

  // notify_dm_received (mig 181) reads NEW.sender_name and falls back to the
  // literal 'Someone' when it is blank. Nothing wrote the column for the
  // app's whole history, so every DM notification ever delivered read
  // "Someone sent you a message". This asserts the column is populated, not
  // merely that the insert succeeded.
  it('never sends a blank sender_name when a username exists', async () => {
    _profileState.profile = { username: 'liftheavy' };
    await hubMessages.sendMessage(base);
    expect(_msgState.createCalls[0].sender_name).toBeTruthy();
  });

  it('falls back to full_name when there is no username', async () => {
    _profileState.profile = { full_name: 'Dana R.' };
    await hubMessages.sendMessage(base);
    expect(_msgState.createCalls[0].sender_name).toBe('Dana R.');
  });

  it('omits the columns entirely when the cache is empty', async () => {
    _profileState.profile = null;
    await hubMessages.sendMessage(base);
    const payload = _msgState.createCalls[0];
    expect('sender_name' in payload).toBe(false);
    expect('sender_avatar' in payload).toBe(false);
  });

  it('still stamps the sender on a media-only message', async () => {
    _profileState.profile = { username: 'liftheavy' };
    await hubMessages.sendMessage({
      conversationId: 'conv-1',
      senderEmail: 'me@x.com',
      body: '',
      messageType: 'sticker',
      stickerId: 'sticker_flex',
    });
    expect(_msgState.createCalls[0].sender_name).toBe('liftheavy');
  });
});
