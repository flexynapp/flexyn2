// src/lib/data/storyPrivacy.js
// Story blocks and default privacy settings.

import { supabase } from '@/api/supabaseClient';

/** Return list of blocked emails for the current user. */
export async function getStoryBlocks(userId) {
  if (!userId) return [];
  const { data } = await supabase
    .from('story_blocks')
    .select('blocked_email, created_at')
    .eq('blocker_id', userId)
    .order('created_at', { ascending: false });
  return data ?? [];
}

/** Block an email from viewing the current user's stories. */
export async function blockUser(user, blockedEmail) {
  if (!user?.id || !blockedEmail) return false;
  const { error } = await supabase
    .from('story_blocks')
    .upsert(
      { blocker_id: user.id, blocker_email: user.email, blocked_email: blockedEmail },
      { onConflict: 'blocker_id,blocked_email' },
    );
  return !error;
}

/** Remove a block. */
export async function unblockUser(userId, blockedEmail) {
  if (!userId || !blockedEmail) return false;
  const { error } = await supabase
    .from('story_blocks')
    .delete()
    .eq('blocker_id', userId)
    .eq('blocked_email', blockedEmail);
  return !error;
}

/** Update the user's default story privacy setting. */
export async function updateDefaultStoryPrivacy(userId, privacy) {
  if (!userId) return false;
  const { error } = await supabase
    .from('user_profiles')
    .update({ default_story_privacy: privacy })
    .eq('id', userId);
  if (error) { console.warn('[storyPrivacy] update failed:', error); return false; }
  return true;
}
