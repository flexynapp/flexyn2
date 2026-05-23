// src/lib/data/photoMealRecognition.js
//
// Photo-AI meal recognition. Sends a JPEG/PNG blob to the
// `recognize-meal` Supabase Edge Function which proxies it to
// Claude Vision and returns a macros estimate.
//
// Fails closed on:
//   • RPC not deployed       → { ok: false, error: 'PIPELINE_MISSING' }
//   • Anthropic key missing  → { ok: false, error: 'SERVER_MISCONFIGURED' }
//   • Image isn't food       → { ok: false, error: 'NOT_FOOD' }
//   • Rate limited           → { ok: false, error: 'RATE_LIMIT' }
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

/**
 * Recognize a meal photo.
 * @param {Blob|File} blob — JPEG/PNG image
 */
export async function recognizeMealPhoto(blob) {
  if (!blob) return { ok: false, error: 'NO_IMAGE' };
  if (blob.size > MAX_BYTES) return { ok: false, error: 'TOO_LARGE' };

  let b64;
  try {
    b64 = await blobToBase64(blob);
  } catch {
    return { ok: false, error: 'READ_FAILED' };
  }

  try {
    const { data, error } = await supabase.functions.invoke('recognize-meal', {
      body: {
        image_base64: b64,
        media_type:   blob.type || 'image/jpeg',
      },
    });
    if (error) {
      // 404 → function not deployed yet. Treat as PIPELINE_MISSING so
      // the UI can show a "this feature isn't enabled on this server"
      // hint instead of an opaque error.
      const status = error.context?.status ?? error.status;
      if (status === 404) return { ok: false, error: 'PIPELINE_MISSING' };
      return { ok: false, error: error.message || 'NETWORK' };
    }
    if (!data) return { ok: false, error: 'EMPTY' };
    return data;
  } catch (err) {
    return { ok: false, error: err?.message || 'NETWORK' };
  }
}
