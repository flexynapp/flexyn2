// src/lib/goBack.js
//
// The header Back button used to send everyone to /dashboard, whatever
// they came from: open a post from Hub, press Back, land on Dashboard.
// Back now means back.
//
// react-router's BrowserRouter writes `idx` into history.state for every
// entry it creates, starting at 0 for the first page of this visit. So
// `idx > 0` means there is an in-app page behind this one and
// navigate(-1) stays inside the app. At idx 0 (a deep link, a push
// notification, a fresh tab) there is nothing of ours behind the page,
// and going back would leave the app, so we go to the fallback instead.
//
// Overlay entries pushed by useOverlayBackButton carry no idx. The header
// sits under every overlay, so its Back is not reachable while one is
// open, and a missing idx falls through to the fallback, never out of
// the app.

export function hasInAppHistory() {
  try {
    const idx = window.history.state?.idx;
    return typeof idx === 'number' && idx > 0;
  } catch {
    return false;
  }
}

export function goBack(navigate, fallback = '/dashboard') {
  if (hasInAppHistory()) navigate(-1);
  else navigate(fallback);
}

export default goBack;

// For pages that consume a router-state hand-off and then wipe it with
// history.replaceState. Passing `{}` there also wiped the router's `idx`,
// so after any hand-off hasInAppHistory() said "no history" and Back fell
// through to the fallback. This keeps key and idx and drops only the
// payload (`usr`), which is the part those pages meant to clear.
export function routerStateWithoutPayload() {
  try {
    const s = window.history.state;
    if (s && typeof s === 'object' && 'idx' in s) return { key: s.key, idx: s.idx, usr: null };
  } catch { /* fall through */ }
  return {};
}
