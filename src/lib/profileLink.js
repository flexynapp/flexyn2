// src/lib/profileLink.js
//
// Reads the username out of a shareable profile link (flexyn.app/@sean).
//
// React Router cannot do this with a route pattern. A dynamic segment must
// be a WHOLE path segment, so `/@:username` is matched as the literal text
// "@:username" and never fires; the public branch in App.jsx falls through
// to its `*` route with no params at all. PublicProfile then read
// `useParams().username` as undefined and told every visitor
// "Profile not found. @ doesn't exist on Flexyn yet", for every shared link.
// Parsing the pathname avoids the router entirely.

export function usernameFromPath(pathname) {
  const match = /^\/@([^/?#]+)/.exec(pathname || '');
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    // A malformed escape (a hand-typed "%") is still a username attempt.
    return match[1];
  }
}
