// src/lib/crewInviteBody.js
//
// The wire format of a crew invite DM, and nothing else.
//
// These three lived in CrewDMInviteCard.jsx next to the component that
// renders them, which is a reasonable place for a parser and a bad place for
// a BUILDER. The two call sites that send an invite — the creation wizard and
// the invite sheet — need only `buildCrewInviteBody`, and importing it from
// the card dragged in framer-motion, the card itself, and `@/lib/data/crews`,
// which imports `@/api/db`, which registers a `supabase.auth.onAuthStateChange`
// listener at module scope. CLAUDE.md names that exact chain: it is why a data
// module must import `@/api/profileCache` rather than `@/api/db`, and it is
// what broke gymRivalOverthrow.test.js. Here it made a component that sends a
// string depend on the auth lifecycle.
//
// The card re-exports all three, so HubChat — which genuinely needs the
// component AND the parser — is unchanged.
//
// The body is a prefix plus JSON rather than a link, because HubChat has to
// recognise it in a plain message row without a schema change to hub_messages.
// The crew id inside it is NOT a capability: migration 250 made the
// `crew_invites` row the thing that grants entry, so forwarding this string to
// somebody uninvited gets them an application, not a membership.

export const CREW_INVITE_PREFIX = '[CREW_INVITE_V1]';

export function parseCrewInvite(body) {
  if (!body?.startsWith(CREW_INVITE_PREFIX)) return null;
  try {
    return JSON.parse(body.slice(CREW_INVITE_PREFIX.length));
  } catch {
    return null;
  }
}

export function buildCrewInviteBody(crewId, crewName, inviterName, inviterAvatar) {
  return CREW_INVITE_PREFIX + JSON.stringify({ crewId, crewName, inviterName, inviterAvatar });
}
