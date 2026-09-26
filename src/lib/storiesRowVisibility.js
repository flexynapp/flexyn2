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
 *
 * SUPERSEDED for the stories row by `orderStoryGroups` — see the note there.
 * Kept because the same predicate still answers a different question (does
 * this avatar get a ring), and because dropping an export is not the change
 * being made here.
 */
export function filterVisibleStoryGroups(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.filter(shouldShowStoryAvatar);
}

/**
 * Order the row WITHOUT dropping anyone: own slot, then friends who have
 * posted, then friends who haven't.
 *
 * This deliberately reverses the hide-them rule above, on a direct and
 * repeated instruction from Sean (12 Aug): "it needs to show your friends
 * first even if your friends don't have anything posted… this is something
 * I've tried talking about for a long time."
 *
 * The original objection is real and is answered by ORDER rather than by
 * absence. Hiding solved "a wall of greyed-out avatars burying the two people
 * who posted" — but it also meant the row could not answer "who am I actually
 * connected to", and a friend who posts nothing for a week simply ceased to
 * exist on the home screen. Sorting content-first keeps every story in the
 * first positions, where the old rule put them, while the rest of the strip
 * stays populated behind them. Nobody has to scroll past silence to reach
 * signal, and nobody vanishes.
 *
 * Stable within each band: `fetchStoriesFeed` has already applied unseen-first
 * ordering, and re-sorting must not undo it. Array.prototype.sort is required
 * to be stable, so equal ranks keep their incoming order.
 */
export function orderStoryGroups(groups) {
  if (!Array.isArray(groups)) return [];
  const rank = (g) => {
    if (g?.isOwn) return 0;
    if (hasActiveStory(g)) return 1;
    if (hasActiveNote(g)) return 2;
    return 3;
  };
  return [...groups].sort((a, b) => rank(a) - rank(b));
}

/**
 * A group the row can only draw as an anonymous placeholder: not you, no
 * username, no avatar, and nothing posted. `isPlaceholder` is set by
 * fetchStoriesFeed when the profile did not resolve to a name or picture.
 */
export function isPlaceholderGroup(group) {
  if (!group || group.isOwn) return false;
  if (hasActiveStory(group) || hasActiveNote(group)) return false;
  return Boolean(group.isPlaceholder);
}

/**
 * What the stories row actually renders: `orderStoryGroups`, minus the
 * anonymous placeholders.
 *
 * This keeps Sean's rule (named friends stay in the row even with nothing
 * posted) and removes only what the owner flagged on 2026-09-26: nine
 * identical "AT / Athlete" circles, which were followed accounts whose
 * profile carried no username and no picture. A circle that cannot say who
 * it is gives the row nothing to show and makes it look unfinished, so it
 * is dropped. If that person posts a story or a note they come back, because
 * then there is something to tap.
 */
export function rowStoryGroups(groups) {
  return orderStoryGroups(groups).filter((g) => !isPlaceholderGroup(g));
}
