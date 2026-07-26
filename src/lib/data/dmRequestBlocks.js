// src/lib/data/dmRequestBlocks.js
//
// The QUIET block list (migration 234's dm_request_blocks).
//
// Distinct from src/lib/data/userBlocks.js. That one wraps
// block_user_full (mig 106): a loud, deliberate block the user chose,
// which also severs mutual follows and mirrors into story_blocks.
//
// This one is a side effect: deleting someone's message request records
// a (blocker, blocked) pair so they can't immediately open a fresh
// request. It carries no other consequence — the two of them can still
// see each other's posts, follow each other, and so on.
//
// It clears itself the moment the blocker signals interest (following
// them, or starting a conversation with them). This module exists so
// Settings can also surface and clear it explicitly.
//
// RLS is owner-only on all three verbs, so these are plain queries — the
// server will not return or delete another user's rows.

import { supabase } from '@/api/supabaseClient';
import { safeSelect } from '@/api/safeSelect';

/**
 * The current user's quiet request blocks, newest first.
 * Returns [] on a pre-234 host (table missing) so Settings just hides
 * the section instead of erroring.
 */
export async function listMyRequestBlocks() {
  const { data, error } = await safeSelect({
    columns: ['blocked_email', 'created_at'],
    build: (cols) => supabase
      .from('dm_request_blocks')
      .select(cols)
      .order('created_at', { ascending: false }),
  });
  if (error) return [];
  return data ?? [];
}

/**
 * Clear one quiet block, letting that person send a message request
 * again. Idempotent — removing a row that isn't there is a no-op.
 */
export async function removeRequestBlock(blockedEmail) {
  if (!blockedEmail) throw new Error('blockedEmail required');
  const { error } = await supabase
    .from('dm_request_blocks')
    .delete()
    .eq('blocked_email', String(blockedEmail).toLowerCase());
  if (error) throw error;
}
