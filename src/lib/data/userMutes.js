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


/** List the current user's mute list. Returns rows with muted_email. */
export async function listMutes(userId) {
  if (!userId) return [];
  const { data, error } = await supabase
    .from('user_mutes')
    .select('muted_email, created_at')
    .eq('muter_id', userId)
    .order('created_at', { ascending: false });
  if (error) return [];
  return data ?? [];
}

/** Mute a user. */
export async function muteUser(user, email) {
  if (!user?.id || !user?.email || !email) throw new Error('user + email required');
  const { error } = await supabase
    .from('user_mutes')
    .upsert(
      { muter_id: user.id, muter_email: user.email, muted_email: email },
      { onConflict: 'muter_id,muted_email' },
    );
  if (error) throw error;
}

/** Unmute a user. */
export async function unmuteUser(userId, email) {
  if (!userId || !email) throw new Error('userId + email required');
  const { error } = await supabase
    .from('user_mutes')
    .delete()
    .eq('muter_id', userId)
    .eq('muted_email', email);
  if (error) throw error;
}
