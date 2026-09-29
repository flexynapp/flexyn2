// src/lib/data/userBlocks.js
//
// Full-scope user blocks. Backed by migration 106 (user_blocks table +
// block_user_full / unblock_user_full RPCs).
//
// Distinct from src/lib/data/storyPrivacy.js (story-only blocks);
// blockUserFull() also writes to story_blocks since story scope is a
// strict subset of full block. Unblocking does NOT cascade — the
// user can keep story scope after a full unblock if they choose.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';


/** Return the current user's full-block list (blocked emails). */
export async function listBlocks(userId) {
  if (!userId) return [];
  const { data, error } = await safeSelect({
    // blocked_id so Settings can name the account instead of showing its
    // address. Populated by the trigger in migration 309; NULL for a block
    // on an email with no Flexyn account.
    // blocked_username is the snapshot Settings renders (migration 314);
    // blocked_id stays for anything that needs to link to the account.
    columns: ['blocked_email', 'blocked_id', 'blocked_username', 'created_at'],
    build: (cols) => supabase
      .from('user_blocks')
      .select(cols)
      .eq('blocker_id', userId)
      .order('created_at', { ascending: false }),
  });
  if (error) return [];
  return data ?? [];
}

/**
 * Block a user. Wraps the atomic RPC that inserts the block, mirrors
 * to story_blocks, and severs any mutual follow rows. Takes the other
 * person's user id; the RPC looks their email up itself.
 */
export async function blockUserFull(targetId) {
  if (!targetId) throw new Error('targetId required');
  const { error } = await supabase.rpc('block_user_full', { p_blocked_id: targetId });
  if (error) throw error;
}

/** Remove a full block by user id (story-scope block is NOT cleared). */
export async function unblockUserFull(targetId) {
  if (!targetId) throw new Error('targetId required');
  const { error } = await supabase.rpc('unblock_user_full', { p_blocked_id: targetId });
  if (error) throw error;
}
