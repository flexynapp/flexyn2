// db.auth.updateMe used to strip any column user_profiles lacked and retry,
// and when it could not name the column it saved only the onboarding flags.
// Either way the caller saw success while data was dropped: that is how
// onboarding's training_equipment and session_minutes went unsaved for weeks.
// It now makes one write and throws on any error.

import { describe, it, expect, vi, beforeEach } from 'vitest';

let upserts = [];
let nextResult;

vi.mock('@/api/supabaseClient', () => ({
  supabase: {
    from: () => ({
      upsert: (payload) => {
        upserts.push(payload);
        return { select: () => ({ single: async () => nextResult }) };
      },
    }),
    auth: {
      onAuthStateChange: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1', email: 'a@b.co' } } }),
    },
  },
}));
vi.mock('@/lib/pushCleanup', () => ({ unsubscribePushOnLogout: vi.fn() }));
vi.mock('@/lib/data/users', () => ({ selectProfiles: vi.fn() }));

const { db } = await import('../db');

describe('updateMe', () => {
  beforeEach(() => { upserts = []; });

  it('throws on a missing column instead of dropping it', async () => {
    nextResult = { data: null, error: { code: 'PGRST204', message: "Could not find the 'training_equipment' column of 'user_profiles' in the schema cache" } };
    await expect(db.auth.updateMe({ training_equipment: 'gym', fitness_level: 'beginner' }))
      .rejects.toMatchObject({ code: 'PGRST204' });
    expect(upserts).toHaveLength(1);
  });

  it('throws when the column cannot be named, rather than saving only the onboarding flags', async () => {
    nextResult = { data: null, error: { code: 'PGRST204', message: 'schema cache miss' } };
    await expect(db.auth.updateMe({ onboarding_complete: true, bio: 'hi' })).rejects.toBeTruthy();
    expect(upserts).toHaveLength(1);
  });

  it('sends the whole payload once and returns the saved row', async () => {
    nextResult = { data: { id: 'u1', email: 'a@b.co', bio: 'hi' }, error: null };
    const row = await db.auth.updateMe({ bio: 'hi' });
    expect(upserts).toHaveLength(1);
    expect(upserts[0]).toMatchObject({ id: 'u1', email: 'a@b.co', bio: 'hi' });
    expect(row).toMatchObject({ bio: 'hi' });
  });
});
