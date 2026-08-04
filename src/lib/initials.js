// src/lib/initials.js
//
// One answer to "what two letters go in this avatar circle".
//
// There wasn't one, and the drift was visible on a single screen: the Hub
// header avatar rendered AR (from full_name "Alex Rivera", via
// ProfileMenu.jsx) while the story avatar 850px below it rendered RE (from
// username "revbot", via HubProfile.jsx) — one user, one viewport, two
// answers. On Profile it read worse: the header showed the empty grey person
// icon because that account had no full_name, while the profile avatar right
// under it showed a pink RE.
//
// The rule: USERNAME first, then full_name, then the email local-part.
//
// Username-first is deliberate and is the reason ProfileMenu is the site that
// changed rather than HubProfile. Hub profiles are username-only by design —
// "No full_name. No email. Falls back to a privacy-safe placeholder" — and
// five of the six existing call sites (HubProfile, StatsHubModal, StoriesRow,
// StoryViewer, HubMessages) already derived initials from the username.
// ProfileMenu was the lone outlier reading full_name. Resolving the drift the
// other way would have quietly pushed real names into avatars on a surface
// that intentionally doesn't show them.
//
// Never falls back to the raw email — the local-part only, and only when
// there is nothing else. A corporate signup as "j.smith.cfo@acme.com" should
// render JS, not the handle. (Same leak class Audit 12 #42/#43 fixed on the
// gym feed.)

/**
 * Two-letter avatar initials for a user-ish object.
 *
 * @param {object|string|null|undefined} user
 *   A profile/user object ({ username, full_name, email }), or a bare
 *   string treated as a username.
 * @param {string} [fallback='?'] rendered when there is nothing usable.
 * @returns {string} 1-2 uppercase characters.
 */
export function initialsFor(user, fallback = '?') {
  if (!user) return fallback;

  const src = typeof user === 'string'
    ? { username: user }
    : user;

  // username → first two characters ("revbot" → RE).
  const username = (src.username || '').trim();
  if (username) return username.slice(0, 2).toUpperCase();

  // full_name → first letter of the first two words ("Alex Rivera" → AR).
  // Split on a whitespace run and filter empties, so a double or trailing
  // space can't produce a leading-space result like " K", which renders
  // visibly off-centre in the avatar circle.
  const name = (src.full_name || '').trim();
  if (name) {
    const letters = name
      .split(/\s+/)
      .filter(Boolean)
      .map(part => part[0])
      .join('')
      .slice(0, 2);
    if (letters) return letters.toUpperCase();
  }

  // email → local-part initials only, never the handle itself.
  const email = (src.email || '').trim();
  if (email) {
    const local = email.split('@')[0];
    if (local) return local.slice(0, 2).toUpperCase();
  }

  return fallback;
}

export default initialsFor;
