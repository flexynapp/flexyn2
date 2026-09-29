// src/lib/data/userMutes.js
//
// Soft "mute" — hide a user's posts from your Hub feed without
// touching follows / DMs / profile visits. The "I love them but
// their posts are a lot right now" tool.
//
// Backed by migration 107 (user_mutes table). Filter is applied
// viewer-side in HubFeed.jsx — the server doesn't hide the rows
// via RLS because mute should be reversible and per-viewer cheap.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';


/** List the current user's mute list. Returns rows with muted_id. */
export async function listMutes(userId) {
  if (!userId) return [];
  const { data, error } = await safeSelect({
    // muted_id — see the note in userBlocks.listBlocks (migration 309).
    columns: ['muted_email', 'muted_id', 'muted_username', 'created_at'],
    build: (cols) => supabase
      .from('user_mutes')
      .select(cols)
      .eq('muter_id', userId)
      .order('created_at', { ascending: false }),
  });
  if (error) return [];
  return data ?? [];
}

/**
 * Mute a user. Idempotent.
 *
 * `ignoreDuplicates: true` is required, not cosmetic: user_mutes has an
 * INSERT policy but no UPDATE policy, so supabase-js's default
 * merge-duplicates (`ON CONFLICT ... DO UPDATE`) failed with `42501 new row
 * violates row-level security policy` whenever the mute already existed —
 * and this one THROWS, so re-muting an already-muted user surfaced as an
 * error. The only non-key column is the muter's own email; there is nothing
 * to update on conflict.
 *
 * The target is named by user id. The pin_mute_target trigger fills
 * muted_email from that profile server-side, so the client never needs,
 * or gets to choose, the other person's email.
 */
export async function muteUser(user, targetId) {
  if (!user?.id || !user?.email || !targetId) throw new Error('user + targetId required');
  const { error } = await supabase
    .from('user_mutes')
    .upsert(
      { muter_id: user.id, muter_email: user.email, muted_id: targetId },
      { onConflict: 'muter_id,muted_email', ignoreDuplicates: true },
    );
  if (error) throw error;
}

/** Unmute a user by their user id. */
export async function unmuteUser(userId, targetId) {
  if (!userId || !targetId) throw new Error('userId + targetId required');
  const { error } = await supabase
    .from('user_mutes')
    .delete()
    .eq('muter_id', userId)
    .eq('muted_id', targetId);
  if (error) throw error;
}
