// src/lib/storiesRowVisibility.js
//
// Who earns a slot in the stories row.
//
// The row used to render every followed user, dimming the ones with
// nothing to show (`opacity-40`, no ring). That turned a content strip
// into a follow list: on an account following a few dozen people you
// scrolled past a wall of greyed-out avatars to find the two that had
// actually posted. The signal was buried in its own noise.
//
// Now the row shows content only:
//
//   • your own slot, always — it is the "Add Story" affordance and has
//     to be reachable whether or not you have posted
//   • anyone with an active (unexpired) story
//   • anyone with an active status note — the "ballin" bubble is real,
//     authored content and reads as such even without a photo
//
// Everyone else is dropped. Note-only users stay tappable: the row's
// press handler routes a no-story group to that person's profile, which
// is also the fallback path for reaching someone whose avatar is no
// longer rendered here (the Hub feed and search both reach profiles, so
// hiding them costs no unique navigation).
//
// Kept as pure functions so the rule is testable without mounting the
// component or standing up a Supabase mock — the grouping itself lives
// in an async fetch (src/lib/data/stories.js fetchStoriesFeed) that is
// awkward to exercise for what is really one boolean.

/** True when the group has at least one active story attached. */
export function hasActiveStory(group) {
  return Array.isArray(group?.stories) && group.stories.length > 0;
}

/** True when the group carries an active status note. */
export function hasActiveNote(group) {
  return Boolean(group?.note);
}

/**
 * Should this group get an avatar in the stories row?
 * Own slot always; otherwise it needs a story or a note.
 */
export function shouldShowStoryAvatar(group) {
  if (!group) return false;
  return Boolean(group.isOwn) || hasActiveStory(group) || hasActiveNote(group);
}

/**
 * Filter a groups list down to the avatars worth rendering, preserving
 * the incoming order (fetchStoriesFeed already sorts own-first, then
 * has-content, then unseen-first).
 */
export function filterVisibleStoryGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.filter(shouldShowStoryAvatar);
}
