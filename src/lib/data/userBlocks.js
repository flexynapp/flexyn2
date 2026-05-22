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

/** Return the current user's full-block list (blocked emails). */
export async function listBlocks(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('user_blocks')
    .select('blocked_email, created_at')
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data ?? [];
}

/**
 * Block a user. Wraps the atomic RPC that inserts the block, mirrors
 * to story_blocks, and severs any mutual follow rows.
 */
export async function blockUserFull(email) {
  if (!email) throw new Error('email required');
  const { error } = await supabase.rpc('block_user_full', { p_blocked_email: email });
  if (error) throw error;
}

/** Remove a full block (story-scope block is NOT cleared). */
export async function unblockUserFull(email) {
  if (!email) throw new Error('email required');
  const { error } = await supabase.rpc('unblock_user_full', { p_blocked_email: email });
  if (error) throw error;
}
