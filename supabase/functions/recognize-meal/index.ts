// supabase/functions/recognize-meal/index.ts
//
// Photo-AI meal recognition. Accepts a base64 image, asks Claude
// Vision to identify the meal and estimate macros, returns a
// structured JSON payload the client can use to prefill the meal
// log form.
//
// ── SETUP (one-time) ─────────────────────────────────────────────────
//
//   1. Get an Anthropic API key from https://console.anthropic.com
//
//   2. Store it as a Supabase function secret:
//
//        supabase secrets set ANTHROPIC_API_KEY="sk-ant-..."
//
//   3. Deploy:
//
//        supabase functions deploy recognize-meal
//
// ── Request shape ────────────────────────────────────────────────────
//   POST  Authorization: Bearer <user JWT>
//   {
//     "image_base64": "/9j/4AAQ...",   // raw bytes, no data URI prefix
//     "media_type":   "image/jpeg"     // optional, defaults to jpeg
//   }
//
// ── Response shape ──────────────────────────────────────────────────
//   {
//     "ok": true,
//     "result": {
//       "food_name":   "Grilled chicken with rice and broccoli",
//       "calories":    540,
//       "protein_g":   45,
//       "carbs_g":     50,
//       "fat_g":       18,
//       "fiber_g":     6,
//       "confidence":  "high" | "medium" | "low",
//       "notes":       "Estimate based on typical portion sizes."
//     }
//   }
//
//   { "ok": false, "error": "NOT_FOOD" }     // image isn't food
//   { "ok": false, "error": "UNAUTHORIZED" } // no JWT
//   { "ok": false, "error": "RATE_LIMIT" }   // soft rate limit hit
//   { "ok": false, "error": "API_ERROR" }    // Anthropic upstream failed
//
// Macros are ESTIMATES. The client should treat them as a starting
// point — let the user edit before saving.

// @ts-ignore — Deno runtime
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MODEL = 'claude-sonnet-4-6';  // good vision quality, fast enough for interactive
const MAX_IMG_BYTES = 5 * 1024 * 1024; // 5MB hard cap

const SYSTEM_PROMPT = `You are a nutrition expert analyzing a photograph of a meal.

Examine the image and return a JSON object with these fields:
  - food_name: short descriptive name (e.g. "Grilled salmon with quinoa")
  - calories: integer estimate (kcal)
  - protein_g: integer estimate (grams)
  - carbs_g: integer estimate (grams)
  - fat_g: integer estimate (grams)
  - fiber_g: integer estimate (grams), can be 0
  - confidence: "high" | "medium" | "low" — how sure you are about portion sizes
  - notes: one short sentence explaining your reasoning or caveats

Estimate portion sizes from visual cues (plate size, hand reference, common
dish proportions). If the image is NOT food, return { "not_food": true }
instead of any macros.

Return ONLY the JSON object. No prose, no markdown fences.`;

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin':  '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  // Auth check — function is invoked through Supabase client which
  // injects the user's JWT; verify it before consuming an Anthropic
  // API call.
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !supabaseKey) {
    return json({ ok: false, error: 'SERVER_MISCONFIGURED' }, 500);
  }
  const client = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: auth } },
  });
  const { data: { user }, error: authErr } = await client.auth.getUser();
  if (authErr || !user) {
    return json({ ok: false, error: 'UNAUTHORIZED' }, 401);
  }

  // Per-user rate limit (2026-06 audit, blocker C22). Each call sends a
  // multi-MB image to Claude Vision (real money); without a cap one
  // authenticated account — including a zero-friction guest — can loop
  // this endpoint and drain the Anthropic budget for everyone. The
  // counter lives in a SECURITY DEFINER RPC (migration 174) that atomically
  // increments a per-user/day row and returns false once the cap is hit.
  // Fails OPEN only on an unexpected RPC error so a counter outage doesn't
  // take the feature down — but a clean "limit reached" returns 429.
  try {
    const { data: allowed, error: rlErr } = await client.rpc('consume_recognize_meal_quota');
    if (!rlErr && allowed === false) {
      return json({ ok: false, error: 'RATE_LIMIT' }, 429);
    }
  } catch (_e) {
    // fall through — never hard-fail the feature on a limiter outage
  }

  // Restrict to formats Claude Vision actually accepts; HEIC/other inputs
  // are downscaled+re-encoded to JPEG client-side before upload.
  const ACCEPTED_MEDIA = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  // Parse body.
  let body: { image_base64?: string; media_type?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: 'INVALID_JSON' }, 400);
  }
  if (!body?.image_base64) {
    return json({ ok: false, error: 'MISSING_IMAGE' }, 400);
  }
  // Soft size check via base64 length (~33% larger than raw bytes).
  if (body.image_base64.length > MAX_IMG_BYTES * 1.5) {
    return json({ ok: false, error: 'IMAGE_TOO_LARGE' }, 413);
  }
  const mediaType = (body.media_type || 'image/jpeg').replace(/^data:/, '').split(';')[0];
  if (!ACCEPTED_MEDIA.includes(mediaType)) {
    return json({ ok: false, error: 'UNSUPPORTED_MEDIA_TYPE' }, 415);
  }

  // Call Anthropic.
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return json({ ok: false, error: 'SERVER_MISCONFIGURED' }, 500);
  }
  let upstream: Response;
  try {
    upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 600,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: body.image_base64 } },
              { type: 'text',  text: 'Analyze this meal and return the JSON.' },
            ],
          },
        ],
      }),
    });
  } catch (e) {
    return json({ ok: false, error: 'API_ERROR' }, 502);
  }
  if (!upstream.ok) {
    // 429 from Anthropic → surface as RATE_LIMIT so the client can
    // show a friendlier "try again in a moment" toast.
    if (upstream.status === 429) {
      return json({ ok: false, error: 'RATE_LIMIT' }, 429);
    }
    return json({ ok: false, error: 'API_ERROR' }, 502);
  }
  const payload = (await upstream.json()) as AnthropicResponse;
  const text = payload?.content?.find((c) => c.type === 'text')?.text || '';
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json({ ok: false, error: 'PARSE_ERROR', raw: text }, 500);
  }
  if (parsed?.not_food) {
    return json({ ok: false, error: 'NOT_FOOD' });
  }
  return json({ ok: true, result: parsed });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type':                'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
