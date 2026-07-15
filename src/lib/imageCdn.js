// src/lib/imageCdn.js
//
// Supabase CDN image transforms — resize/recompress at the edge instead
// of shipping full uploads to every viewer. A raw feed image is often
// 300-400 KB; the collapsed feed preview renders it 100px tall and
// blurred, so a width-320 transform is ~10x less egress for identical
// pixels on screen.
//
// GATED OFF BY DEFAULT: transformations are a paid Supabase feature and
// this project's render endpoint currently returns 403 (probed
// 2026-07-15). Set VITE_IMAGE_CDN=1 in the build env (Netlify) after
// upgrading the Supabase plan to turn transforms on — no code change
// needed. Until then cdnImageUrl() passes URLs through untouched.
//
// Even when enabled, every call site must keep a runtime fallback
// (onError → cdnFallbackSrc) so a plan downgrade or endpoint hiccup
// degrades to the raw image instead of a broken one.

const OBJECT_MARKER = '/storage/v1/object/public/';
const RENDER_MARKER = '/storage/v1/render/image/public/';

const enabled = () => {
  try {
    return import.meta.env?.VITE_IMAGE_CDN === '1';
  } catch {
    return false;
  }
};

/**
 * Rewrite a Supabase public-object URL to its CDN render (transform)
 * URL. Non-Supabase-storage URLs (or when the flag is off) pass through
 * unchanged. Never call this for videos — the render endpoint is
 * images only.
 *
 * @param {string} url
 * @param {{ width?: number, quality?: number }} [opts]
 */
export function cdnImageUrl(url, { width, quality = 75 } = {}) {
  if (!enabled()) return url;
  if (!url || typeof url !== 'string') return url;
  const idx = url.indexOf(OBJECT_MARKER);
  if (idx === -1) return url; // not a Supabase public object (or already transformed)
  const base = url.slice(0, idx);
  const path = url.slice(idx + OBJECT_MARKER.length);
  const params = new URLSearchParams();
  if (width) params.set('width', String(width));
  if (quality) params.set('quality', String(quality));
  const qs = params.toString();
  return `${base}${RENDER_MARKER}${path}${qs ? `?${qs}` : ''}`;
}

/**
 * onError companion: given the raw (untransformed) URL, swap the failed
 * <img> back to it. Returns true if a swap happened (caller should NOT
 * run its own error handling yet — the raw URL gets its own chance),
 * false if the raw URL itself failed (caller handles: hide, placeholder…).
 */
export function cdnFallbackSrc(event, rawUrl) {
  const el = event?.currentTarget;
  if (!el || !rawUrl) return false;
  if (el.src !== rawUrl && el.src.includes(RENDER_MARKER)) {
    el.src = rawUrl;
    return true;
  }
  return false;
}
