// ownedRows is a drop-in for the old db.entities client, table by table.
//
// Every data module is moving off db.entities onto ownedRows. The modules
// with statement tests prove it for their own calls; this proves it for the
// helper itself, so a module whose tests only fake the row layer (the hub
// tables) moves on evidence rather than on reading two files side by side.
// Each case runs the same call through both and compares every statement
// sent and the value returned. It is deleted with db.entities.
//
// `User` is excluded on purpose: it reads through the public_profiles view
// and nothing moves it here (profiles are read through lib/data/users).

import { describe, it, expect, vi, beforeEach } from 'vitest';

let calls = [];
let results = [];

function chain(table) {
  const q = {};
  const rec = (name) => (...args) => { calls.push([table, name, ...args]); return q; };
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update', 'delete', 'single', 'maybeSingle']) {
    q[m] = rec(m);
  }
  q.then = (resolve, reject) => Promise.resolve(results.shift() ?? { data: null, error: null }).then(resolve, reject);
  return q;
}

const getSession = vi.fn();
vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: (table) => { calls.push([table, 'from']); return chain(table); },
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: (...a) => getSession(...a),
    },
  },
}));
vi.mock('@/lib/pushCleanup', () => ({ unsubscribePushOnLogout: vi.fn() }));
vi.mock('@/lib/data/users', () => ({ selectProfiles: vi.fn() }));

const { db } = await import('@/api/db');
const { ownedRows } = await import('../ownedRows');

const TABLES = {
  HubPost: 'hub_posts',
  HubFollow: 'hub_follows',
  HubComment: 'hub_comments',
  HubCommentLike: 'hub_comment_likes',
  HubReaction: 'hub_reactions',
  HubConversation: 'hub_conversations',
  HubMessage: 'hub_messages',
};

// [label, call, canned database results]
const CASES = [
  ['filter by one column', (x) => x.filter({ post_id: 'p1' }, 'created_date', 50), [{ data: [{ id: 1 }], error: null }]],
  ['filter with an array and a skipped null', (x) => x.filter({ id: ['a', 'b'], privacy: null }, '-created_date', 2), [{ data: [], error: null }]],
  ['filter with no conditions and no sort', (x) => x.filter({}), [{ data: null, error: null }]],
  ['filter with an empty owner key', (x) => x.filter({ created_by: '' }, '-created_date', 1), []],
  ['filter that fails', (x) => x.filter({ follower_email: 'a' }, '-created_date', 500), [{ data: null, error: { code: '42501' } }]],
  ['get', (x) => x.get('g1'), [{ data: { id: 'g1' }, error: null }]],
  ['create', (x) => x.create({ comment_id: 'c1', user_id: 'forged', created_by: 'forged@x.co' }), [{ data: { id: 'n' }, error: null }]],
  ['create that fails', (x) => x.create({ body: 'hi' }), [{ data: null, error: { code: '23505', message: 'dup' } }]],
  ['update', (x) => x.update('u', { read_at: 'now' }), [{ data: { id: 'u' }, error: null }]],
  ['update that fails', (x) => x.update('u', { a: 1 }), [{ data: null, error: { code: 'PGRST116' } }]],
  ['delete', (x, old) => (old ? x.delete('d') : x.remove('d')), [{ error: null }]],
  ['delete that fails', (x, old) => (old ? x.delete('d') : x.remove('d')), [{ error: { code: '42501' } }]],
];

async function run(fn, target, old, canned) {
  calls = [];
  results = canned.map((r) => ({ ...r }));
  let value;
  let error;
  try { value = await fn(target, old); } catch (e) { error = e; }
  return { calls, value, error };
}

const SESSIONS = {
  member: { data: { session: { user: { id: 'u1', email: 'a@b.co' } } } },
  guest: { data: { session: { user: { id: 'g1', email: null } } } },
};

beforeEach(() => getSession.mockReset());

describe.each(Object.entries(TABLES))('%s', (entity, table) => {
  it.each(Object.keys(SESSIONS))('matches the old client call for call, signed in as a %s', async (who) => {
    getSession.mockResolvedValue(SESSIONS[who]);
    for (const [label, fn, canned] of CASES) {
      const before = await run(fn, db.entities[entity], true, canned);
      const after = await run(fn, ownedRows(table), false, canned);
      expect({ label, ...after }).toEqual({ label, ...before });
    }
  });
});
