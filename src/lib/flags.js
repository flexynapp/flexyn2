// src/lib/flags.js
//
// Country flags are served from our own origin (public/flags/<code>.svg),
// Twemoji artwork, CC-BY 4.0 (see ATTRIBUTIONS.md).
//
// They used to load from cdn.jsdelivr.net/gh/twitter/twemoji. That host is
// a GitHub mirror with no uptime promise for us, and on at least one real
// device (Kegan's, 2026-09-29) the flag beside the city rendered as a broken
// image while the rest of the profile was fine. An image the page depends
// on should come from the same place as the page.
//
// Why an image at all: Windows has no flag emoji, so "🇺🇸" renders there as
// the letters "US". Only the countries the flag picker offers are bundled.

// Accepts what user_profiles.country_flag holds, which is the flag emoji
// (two regional indicator symbols) for every row written by the picker, or a
// bare ISO code from older rows. Returns the two-letter code, lowercased.
export function flagCode(value) {
  if (!value || typeof value !== 'string') return null;
  const points = [...value].map((c) => c.codePointAt(0)).filter((cp) => cp !== 0xfe0f);
  if (points.length === 2 && points.every((cp) => cp >= 0x1f1e6 && cp <= 0x1f1ff)) {
    return points.map((cp) => String.fromCharCode(cp - 0x1f1e6 + 97)).join('');
  }
  if (/^[A-Za-z]{2}$/.test(value.trim())) return value.trim().toLowerCase();
  return null;
}

export function flagSrc(value) {
  const code = flagCode(value);
  return code ? `/flags/${code}.svg` : null;
}
