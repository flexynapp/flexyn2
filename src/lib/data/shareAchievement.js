// src/lib/data/shareAchievement.js
//
// One-tap "Post to Hub" for an unlocked achievement. Constructs the
// same post payload HubComposer would build for an achievement share
// and saves it directly via hubPosts.create — skipping the composer
// modal entirely. The user gets a sonner toast with an "Open" action
// pointing to the post.

import * as hubPosts from './hubPosts';

const POST_TYPE = 'achievement';

/**
 * Share an unlocked achievement to Hub as a public post.
 *
 * @param {object} opts
 * @param {object} opts.user
 * @param {object} opts.achievement   row from achievements list:
 *   { achievement_id, name, description, icon, unlockedDate, xp_reward, nameKey, descriptionKey }
 * @returns {Promise<{ ok: true, postId } | { ok: false, error }>}
 */
export async function shareAchievementPost({ user, achievement }) {
  if (!user?.email || !achievement?.achievement_id) {
    return { ok: false, error: 'invalid_args' };
  }
  const snapshot = {
    achievement_id: achievement.achievement_id,
    name:           achievement.name || achievement.nameKey || 'Achievement',
    description:    achievement.description || achievement.descriptionKey || '',
    icon:           achievement.icon || '🏆',
    unlocked_date:  achievement.unlockedDate || new Date().toISOString(),
    xp_reward:      achievement.xp_reward || null,
  };
  const friendly = `🏆 Unlocked: ${snapshot.name}`;
  try {
    const post = await hubPosts.create({
      author_email:           user.email,
      author_name:            user.username ? `@${user.username}` : 'Athlete',
      author_avatar_url:      user.avatar_url || null,
      post_type:              POST_TYPE,
      body:                   friendly,
      privacy:                'public',
      like_count:             0,
      dislike_count:          0,
      comment_count:          0,
      linked_entity_type:     'achievement',
      linked_entity_id:       achievement.achievement_id,
      linked_entity_snapshot: snapshot,
    });
    return { ok: true, postId: post?.id || null };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
