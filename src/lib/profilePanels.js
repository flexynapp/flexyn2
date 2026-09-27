// src/lib/profilePanels.js
//
// The overlays that used to open only from the header's profile menu:
// Weekly Reviews, Injuries, and the sign-out / delete-account confirms.
// Delete account is requested from Settings › Account; the rest from You.
//
// Navigation redesign, phase 2: the profile menu became the You tab, but
// ProfileMenu still OWNS these overlays (it stays mounted in the header
// with its trigger hidden), so the You page asks for them by event rather
// than duplicating the overlay wiring. Same pattern as
// OPEN_ACHIEVEMENTS_EVENT (achievementsFlow.js) and requestOpenJournal
// (journalOverlay.js), which the You page uses for those two.

export const OPEN_PROFILE_PANEL_EVENT = 'flexyn:open-profile-panel';

export const PROFILE_PANELS = ['reviews', 'injuries', 'signOut', 'deleteAccount'];

export function requestProfilePanel(panel) {
  if (!PROFILE_PANELS.includes(panel)) return;
  try {
    window.dispatchEvent(new CustomEvent(OPEN_PROFILE_PANEL_EVENT, { detail: { panel } }));
  } catch { /* no window: nothing to open */ }
}
