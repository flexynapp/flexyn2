// src/lib/privacy.js
//
// Privacy-mode visibility helpers. Backed by the `is_private` and
// `hide_from_search` columns on user_profiles (migration 117). Used by:
//
//   • HubProfile         — canViewProfile() gates the profile-page body
//   • User search / PYMK — filterSearchable() strips hidden profiles
//
// Pure functions; no IO. The caller passes in the relevant profile +
// the viewer's follow relationship.

/**
 * Decide whether a viewer can see a profile's full content.
 *
 * @param {object} viewer          { email, id }
 * @param {object} profile         { email, id, is_private }
 * @param {boolean} viewerFollowsOwner   does the viewer follow the profile owner?
 * @returns {boolean}
 */
export function canViewProfile(viewer, profile, viewerFollowsOwner) {
  if (!profile) return false;
  // Public profile → anyone can see it.
  if (!profile.is_private) return true;
  // Owner viewing themselves → always yes.
  if (viewer?.id && profile.id && viewer.id === profile.id) return true;
  if (viewer?.email && profile.email && String(viewer.email).toLowerCase() === String(profile.email).toLowerCase()) return true;
  // Otherwise the viewer must follow the private account.
  return !!viewerFollowsOwner;
}

/**
 * Filter a list of profiles down to the ones visible in search / PYMK.
 * Anyone with hide_from_search=true is excluded; the viewer's own
 * profile is always kept so a user searching for themselves still
 * finds their account.
 *
 * @param {Array<{ id?: string, email?: string, hide_from_search?: boolean }>} profiles
 * @param {{ id?: string, email?: string }} viewer
 * @returns {Array}
 */
export function filterSearchable(profiles, viewer) {
  if (!Array.isArray(profiles)) return [];
  const viewerEmailLc = String(viewer?.email || '').toLowerCase();
  const viewerId      = viewer?.id || null;
  return profiles.filter(p => {
    if (!p) return false;
    if (!p.hide_from_search) return true;
    // Always keep the viewer's own row.
    if (p.id && viewerId && p.id === viewerId) return true;
    if (p.email && viewerEmailLc && String(p.email).toLowerCase() === viewerEmailLc) return true;
    return false;
  });
}
