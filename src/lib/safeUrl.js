// src/lib/safeUrl.js
//
// Guard user-controlled URLs before putting them in an href. Only http(s)
// external links are allowed through; anything else (javascript:, data:,
// vbscript:, file:, relative, garbage) returns null so the caller can skip
// rendering the link. This defends against stored-XSS where a user saves a
// `javascript:…` value into their own profile/gym website_url column and it
// executes for anyone who taps the link. Scheme normalization at the save
// site is not enough — the render site must fail closed too.
export function safeExternalUrl(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const u = new URL(url.trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') ? u.href : null;
  } catch {
    return null;
  }
}
