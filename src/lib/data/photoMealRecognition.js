// src/lib/data/photoMealRecognition.js
//
// Photo-AI meal recognition. Sends a JPEG/PNG blob to the
// `recognize-meal` Supabase Edge Function which proxies it to
// Claude Vision and returns a macros estimate.
//
// Before upload the image is decoded and re-encoded through a canvas:
//   • longest edge scaled to ≤1280 px, JPEG quality 0.85 — keeps
//     modern phone photos (~3–8 MB) comfortably under the size cap
//     instead of rejecting them outright
//   • converts HEIC (and anything else the browser can decode) to
//     JPEG, which Anthropic accepts; if the browser can't decode the
//     format at all we fail with UNSUPPORTED_FORMAT instead of
//     forwarding bytes the API will 400 on
//
// Fails closed on:
//   • RPC not deployed       → { ok: false, error: 'PIPELINE_MISSING' }
//   • Anthropic key missing  → { ok: false, error: 'SERVER_MISCONFIGURED' }
//   • Image isn't food       → { ok: false, error: 'NOT_FOOD' }
//   • Rate limited           → { ok: false, error: 'RATE_LIMIT' }
//   • Image too large        → { ok: false, error: 'IMAGE_TOO_LARGE' }
//   • Undecodable format     → { ok: false, error: 'UNSUPPORTED_FORMAT' }
//   • 30 s with no response  → { ok: false, error: 'TIMEOUT' }
//   • Network                → { ok: false, error: 'NETWORK' }
//
// All errors are surfaced to the UI for a friendly toast. The result
// shape (when ok: true):
//   {
//     food_name, calories, protein_g, carbs_g, fat_g, fiber_g,
//     confidence, notes,
//   }

import { supabase } from '@/api/supabaseClient';

const MAX_BYTES = 4 * 1024 * 1024; // 4 MB — leaves headroom under the
                                    // function's 5 MB cap once base64
                                    // expansion lands
const MAX_EDGE_PX = 1280;           // longest edge after downscale
const JPEG_QUALITY = 0.85;
const DEFAULT_TIMEOUT_MS = 30_000;

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      // Strip the "data:<mime>;base64," prefix the function expects to
      // not see — keeps the function's parsing identical regardless of
      // whether the client sent a Blob or a data URL.
      const idx = result.indexOf('base64,');
      resolve(idx >= 0 ? result.slice(idx + 7) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

// Decode the blob (createImageBitmap first, <img> fallback for formats
// it rejects), scale the longest edge to ≤MAX_EDGE_PX, and re-encode
// as JPEG. Throws when the browser can't decode the format at all
// (e.g. HEIC on most non-Safari browsers).
async function downscaleImage(blob) {
  let bitmap = null;
  try {
    if (typeof createImageBitmap === 'function') {
      bitmap = await createImageBitmap(blob);
    }
  } catch { /* fall through to <img> decode */ }

  let source = bitmap;
  let width = bitmap?.width;
  let height = bitmap?.height;

  if (!bitmap) {
    source = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image decode failed')); };
      img.src = url;
    });
    width = source.naturalWidth;
    height = source.naturalHeight;
  }
  if (!width || !height) throw new Error('image decode produced no pixels');

  const scale = Math.min(1, MAX_EDGE_PX / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');
  ctx.drawImage(source, 0, 0, w, h);
  bitmap?.close?.();

  const out = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!out) throw new Error('canvas encode failed');
  return out;
}

// supabase-js wraps non-2xx Edge Function responses in a
// FunctionsHttpError whose `.context` is the raw fetch Response — the
// JSON body with the real machine code ('IMAGE_TOO_LARGE',
// 'RATE_LIMIT', …) is hidden behind a generic message unless we parse
// it ourselves.
async function parseFunctionError(error) {
  const ctx = error?.context;
  let status = ctx?.status ?? error?.status ?? null;
  try {
    if (ctx && typeof ctx.json === 'function') {
      const resp = typeof ctx.clone === 'function' ? ctx.clone() : ctx;
      const body = await resp.json();
      if (body?.error) return { code: String(body.error), status };
    }
  } catch { /* non-JSON body — fall through to status mapping */ }
  return { code: null, status };
}

/**
 * Recognize a meal photo.
 * @param {Blob|File} blob — any image the browser can decode
 * @param {{ timeoutMs?: number }} [opts]
 */
export async function recognizeMealPhoto(blob, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!blob) return { ok: false, error: 'NO_IMAGE' };

  // Re-encode through a canvas: downscales oversized photos under the
  // cap and normalises exotic formats (HEIC) to JPEG.
  let upload = blob;
  let mediaType = blob.type || 'image/jpeg';
  try {
    upload = await downscaleImage(blob);
    mediaType = 'image/jpeg';
  } catch {
    // Browser can't decode this format. A small JPEG/PNG/WebP/GIF can
    // still go up as-is; anything else (HEIC on non-Safari) would 400
    // at Anthropic — surface a clear unsupported-format error instead.
    if (!/^image\/(jpe?g|png|webp|gif)$/i.test(blob.type || '')) {
      return { ok: false, error: 'UNSUPPORTED_FORMAT' };
    }
  }
  if (upload.size > MAX_BYTES) return { ok: false, error: 'IMAGE_TOO_LARGE' };

  let b64;
  try {
    b64 = await blobToBase64(upload);
  } catch {
    return { ok: false, error: 'READ_FAILED' };
  }

  // Client-side timeout — without it a stalled Edge Function leaves
  // the Photo-AI button spinning forever.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { data, error } = await supabase.functions.invoke('recognize-meal', {
      body: {
        image_base64: b64,
        media_type:   mediaType,
      },
      signal: controller.signal,
    });
    if (error) {
      if (controller.signal.aborted) return { ok: false, error: 'TIMEOUT' };
      const { code, status } = await parseFunctionError(error);
      if (code) return { ok: false, error: code };
      // 404 → function not deployed yet. Treat as PIPELINE_MISSING so
      // the UI can show a "this feature isn't enabled on this server"
      // hint instead of an opaque error.
      if (status === 404) return { ok: false, error: 'PIPELINE_MISSING' };
      if (status === 413) return { ok: false, error: 'IMAGE_TOO_LARGE' };
      if (status === 429) return { ok: false, error: 'RATE_LIMIT' };
      return { ok: false, error: error.message || 'NETWORK' };
    }
    if (!data) return { ok: false, error: 'EMPTY' };
    return data;
  } catch (err) {
    if (controller.signal.aborted) return { ok: false, error: 'TIMEOUT' };
    return { ok: false, error: err?.message || 'NETWORK' };
  } finally {
    clearTimeout(timer);
  }
}
