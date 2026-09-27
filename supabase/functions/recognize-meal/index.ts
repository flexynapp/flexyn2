// supabase/functions/recognize-meal/index.ts
//
// Photo-AI meal recognition. verify_jwt is FALSE at the gateway so the
// browser CORS preflight (OPTIONS, no Authorization) isn't rejected; auth
// is enforced inside the function (Bearer JWT + client.auth.getUser()).
//
// Setup: supabase secrets set ANTHROPIC_API_KEY="sk-ant-..."

// @ts-ignore — Deno runtime
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MODEL = 'claude-sonnet-4-6';
const MAX_IMG_BYTES = 5 * 1024 * 1024;

// supabase-js sends apikey + x-client-info on every browser invoke; the CORS
// preflight fails unless they're allowed here alongside authorization.
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SYSTEM_PROMPT = `You are a nutrition expert analyzing a photograph of a meal, like the Cal AI app.

Examine the image carefully and return a JSON object with these fields:
  - food_name: short descriptive name of the whole dish (e.g. "Grilled salmon with quinoa and asparagus")
  - portion_estimate: the total serving you're estimating, in plain words WITH a weight
      or volume when you can (e.g. "1 plate (~450 g)", "1 cup", "2 slices (~120 g)").
  - items: an array of the distinct foods on the plate — break the meal into its real
      components (usually 2-6). Each item is an object:
        { "name": "Grilled chicken breast", "amount": "~180 g",
          "calories": 280, "protein_g": 52, "carbs_g": 0, "fat_g": 6 }
      Estimate each item's own portion and macros. The totals below MUST equal the sum of
      the items. If it's truly a single food, return one item.
  - calories: integer kcal — the TOTAL (sum of items)
  - protein_g: integer grams — total
  - carbs_g: integer grams — total
  - fat_g: integer grams — total
  - fiber_g: integer grams total (0 if unsure)
  - sugar_g: integer grams total (0 if unsure)
  - sodium_mg: integer milligrams total (0 if unsure)
  - confidence: "high" | "medium" | "low" — how sure you are about the portion sizes
  - notes: one short sentence with any caveats (e.g. "Sauce hidden under the rice may add fat.").

How to estimate the portion (this is the hard part — get it right):
  - Anchor scale to reference objects: plate/bowl diameter, fork/spoon length, a hand,
    standard can/bottle sizes. A dinner plate is ~27 cm; a fork is ~19 cm.
  - Judge depth and coverage, not just the top-down area — a mounded bowl holds far more
    than a flat one of the same width.
  - Prefer a realistic single-serving estimate over a round number.

If the image is NOT food, return { "not_food": true } instead of any macros.

Return ONLY the JSON object. No prose, no markdown fences.`;

interface AnthropicResponse {
  content?: Array<{ type: string; text?: string }>;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== 'POST') {
    return json({ ok: false, error: 'METHOD_NOT_ALLOWED' }, 405);
  }

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

  // Per-user daily quota (migration 174 / 229 / 280) plus an all-users daily
  // ceiling (migration 385). A clean cap-reached is 429.
  //
  // Fails CLOSED on RPC error (migration 385 era). It used to fail open so a
  // counter outage couldn't take the feature down, but that also meant an
  // outage removed every limit at once, and this is the most expensive call
  // in the app. A scan that can't be counted is refused with 503, and the
  // client already shows a generic "try again" for any code it doesn't know.
  //
  // The consume stays BEFORE the work, because it is the atomic gate that
  // stops someone firing fifty concurrent recognitions at the Anthropic
  // budget. But the user must not pay for a scan we never delivered, so
  // every failure path below refunds via `fail()`. `consumed` tracks whether
  // we actually took one, so a refund never mints a free scan.
  let consumed = false;
  try {
    const { data: allowed, error: rlErr } = await client.rpc('consume_recognize_meal_quota');
    if (!rlErr && allowed === false) {
      // Denied at the cap. Migration 280 makes this a no-op on the counter,
      // so there is nothing to give back.
      return json({ ok: false, error: 'RATE_LIMIT' }, 429);
    }
    if (rlErr) return json({ ok: false, error: 'QUOTA_UNAVAILABLE' }, 503);
    consumed = true;
  } catch (_e) {
    return json({ ok: false, error: 'QUOTA_UNAVAILABLE' }, 503);
  }

  // Every non-success exit after this point goes through fail(), which
  // returns the scan first. A refund failure is swallowed: we would rather
  // hand back the real error than mask it with a bookkeeping one.
  const fail = async (obj: unknown, status = 200) => {
    if (consumed) {
      // Refunds are service-role only (2026-09-27 audit): a user-callable
      // refund let anyone loop consume/refund past every cap. The caller's
      // id comes from the getUser() check above, never from the request.
      try {
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        if (serviceKey) {
          await createClient(supabaseUrl, serviceKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          }).rpc('refund_recognize_meal_quota_for', { p_user_id: user.id });
        }
      } catch (_e) { /* best effort */ }
    }
    return json(obj, status);
  };

  const ACCEPTED_MEDIA = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

  let body: { image_base64?: string; media_type?: string } | null = null;
  try {
    body = await req.json();
  } catch {
    return await fail({ ok: false, error: 'INVALID_JSON' }, 400);
  }
  if (!body?.image_base64) {
    return await fail({ ok: false, error: 'MISSING_IMAGE' }, 400);
  }
  if (body.image_base64.length > MAX_IMG_BYTES * 1.5) {
    return await fail({ ok: false, error: 'IMAGE_TOO_LARGE' }, 413);
  }
  const mediaType = (body.media_type || 'image/jpeg').replace(/^data:/, '').split(';')[0];
  if (!ACCEPTED_MEDIA.includes(mediaType)) {
    return await fail({ ok: false, error: 'UNSUPPORTED_MEDIA_TYPE' }, 415);
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return await fail({ ok: false, error: 'SERVER_MISCONFIGURED' }, 500);
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
        // Room for the per-item breakdown array. Still a tight cap.
        max_tokens: 1200,
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
  } catch (_e) {
    return await fail({ ok: false, error: 'API_ERROR' }, 502);
  }
  if (!upstream.ok) {
    if (upstream.status === 429) {
      return await fail({ ok: false, error: 'RATE_LIMIT' }, 429);
    }
    return await fail({ ok: false, error: 'API_ERROR' }, 502);
  }
  const payload = (await upstream.json()) as AnthropicResponse;
  const text = payload?.content?.find((c) => c.type === 'text')?.text || '';
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    return await fail({ ok: false, error: 'PARSE_ERROR', raw: text }, 500);
  }
  if (parsed?.not_food) {
    return await fail({ ok: false, error: 'NOT_FOOD' });
  }
  return json({ ok: true, result: parsed });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
