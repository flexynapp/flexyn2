// supabase/functions/osm-gyms-fill/index.ts
//
// Fills public.osm_gym_cache for a bounding box from OpenStreetMap.
//
// The picker reads the cache directly through get_osm_gyms_cached (~19ms).
// This runs only when that read reports uncovered tiles, and it is the
// ONLY thing that ever talks to Overpass. Measured before this existed,
// from a phone's point of view:
//
//   Overpass,  5 mi radius      4.3s   3.5s   2.3s
//   Overpass, 30 mi radius     30.0s✗  5.9s   4.6s
//   get_gyms_in_bbox                   19 ms
//
// Moving the Overpass call server-side buys three things beyond the
// obvious one. It is paid ONCE per area rather than once per user. It
// runs on a datacentre connection instead of cellular. And it can send a
// real User-Agent, which a browser cannot — `fetch` forbids setting that
// header, so every request the app made was anonymous traffic against a
// donated service that rate-limits exactly that.
//
// Deploy:  supabase functions deploy osm-gyms-fill
//
// Auth is the platform's JWT verification (left ON, unlike send-push
// which must accept a pg_net trigger). A signed-in user is the only
// caller, which is what stops this becoming an open proxy for hammering
// Overpass on our IP.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const TILE_DEG = 0.1;

// A rounded box wider than this is a map viewport, not a "gyms near me"
// query, and filling it would mean pulling a country into the cache on
// one user's tap. Those callers keep going straight to Overpass.
const MAX_SPAN_DEG = 2.0;

const TILE_TTL_DAYS = 30;

const OVERPASS_MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  // Answers a server User-Agent fine. It 406s browsers, which is why the
  // client-side list treated it as a dead racer — from here it works.
  'https://overpass-api.de/api/interpreter',
];

const USER_AGENT =
  'Flexyn/1.0 (fitness app gym locator; +https://github.com/flexynapp/flexyn2)';

const OVERPASS_TIMEOUT_S = 60;
const MIRROR_ABORT_MS = 70_000;

// Kept deliberately in step with GYM_SELECTORS in src/lib/osmGyms.js.
// Every selector is an exact key=value so Overpass can use its index; a
// regex or a negative match degrades into a bbox scan and 504s.
const GYM_SELECTORS = [
  '["leisure"="fitness_centre"]',
  '["leisure"="sports_centre"]',
  '["amenity"="gym"]',
  '["club"="fitness"]',
  '["sport"="fitness"]',
  '["sport"="gymnastics"]',
  '["sport"="climbing"]',
];

// Mirrors isGymLike() in src/lib/osmGyms.js. The query over-fetches on
// cheap indexed lookups and the judgement happens here, on tags already
// in hand — see that file for why the split is load-bearing.
const GYM_SPORTS = new Set([
  'fitness', 'gym', 'exercise', 'multi', 'weightlifting', 'crossfit',
  'bodybuilding', 'calisthenics', 'climbing', 'bouldering', 'boxing',
  'kickboxing', 'muay_thai', 'martial_arts', 'judo', 'karate', 'taekwondo',
  'wrestling', 'gymnastics', 'yoga', 'pilates', 'dance',
]);

const NON_GYM_SPORTS = new Set([
  'tennis', 'padel', 'squash', 'badminton', 'table_tennis', 'swimming',
  'diving', 'scuba_diving', 'surfing', 'sailing', 'canoe', 'rowing',
  'golf', 'soccer', 'football', 'american_football', 'rugby',
  'rugby_union', 'rugby_league', 'baseball', 'softball', 'basketball',
  'volleyball', 'beachvolleyball', 'handball', 'netball', 'lacrosse',
  'cricket', 'field_hockey', 'ice_hockey', 'hockey', 'curling',
  'skating', 'ice_skating', 'roller_skating', 'skiing', 'snowboard',
  'bowling', 'billiards', 'darts', 'archery', 'shooting', 'paintball',
  'laser_tag', 'axe_throwing', 'equestrian', 'horse_riding',
  'horse_racing', 'polo', 'motor', 'motocross', 'karting', 'cycling',
  'bmx', 'skateboard', 'athletics', 'running', 'chess', 'fishing',
]);

const GYM_NAME_RE =
  /\b(gyms?|fitness|crossfit|barbell|strength|health club|athletic club|ymca|ywca|jcc|recreation cent(er|re)|rec cent(er|re)|boxing|jiu[-\s]?jitsu|mma|pilates|yoga)\b/i;

function isGymLike(tags: Record<string, string> = {}): boolean {
  if (tags.leisure === 'fitness_centre') return true;
  if (tags.leisure === 'fitness_station') return true;
  if (tags.amenity === 'gym') return true;
  if (tags.club === 'fitness') return true;

  const sports = String(tags.sport || '')
    .split(';').map((s) => s.trim().toLowerCase()).filter(Boolean);

  if (sports.some((s) => GYM_SPORTS.has(s))) return true;
  if (sports.length > 0 && sports.every((s) => NON_GYM_SPORTS.has(s))) return false;
  if (GYM_NAME_RE.test(tags.name || '')) return true;

  return tags.leisure === 'sports_centre' && sports.length === 0;
}

// CORS is not optional here, unlike send-push.
//
// send-push is called by pg_net from a database trigger — server to
// server, no browser, no preflight — so nothing in this project had ever
// needed these headers. This function is called from the app, and
// supabase-js sends `Authorization` and `Content-Type: application/json`,
// which makes it a non-simple request: the browser fires an OPTIONS
// preflight FIRST and will not send the POST unless that preflight comes
// back with permission.
//
// The method guard below used to answer OPTIONS with 405 and no CORS
// headers, so the preflight failed, the POST was never sent, and the
// client saw an instant network error — which the picker rendered as
// "OpenStreetMap didn't respond". Overpass was never contacted. The logs
// showed four OPTIONS 405s and zero POSTs.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });

/** Race the mirrors; first usable answer wins, losers are aborted. */
async function queryOverpass(q: string): Promise<{ elements?: unknown[] }> {
  const ctrls: AbortController[] = [];
  const attempt = async (mirror: string) => {
    const ctrl = new AbortController();
    ctrls.push(ctrl);
    const timer = setTimeout(
      () => ctrl.abort(new Error(`timed out after ${MIRROR_ABORT_MS / 1000}s`)),
      MIRROR_ABORT_MS,
    );
    try {
      const res = await fetch(mirror, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `data=${encodeURIComponent(q)}`,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`${mirror.split('/')[2]} ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    const result = await Promise.any(OVERPASS_MIRRORS.map(attempt));
    for (const c of ctrls) { try { c.abort('won'); } catch { /* ignore */ } }
    return result;
  } catch (err) {
    const errs = (err as AggregateError)?.errors ?? [err];
    throw new Error(errs.map((e: Error) => e?.message || String(e)).join('; '));
  }
}

Deno.serve(async (req: Request) => {
  // Answer the preflight before anything else, including the method
  // guard — an OPTIONS that gets 405 is a POST that never happens.
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  let body: Record<string, number>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad_json' }, 400);
  }

  const minLat = Number(body.minLat);
  const maxLat = Number(body.maxLat);
  const minLng = Number(body.minLng);
  const maxLng = Number(body.maxLng);
  const bounds = [minLat, maxLat, minLng, maxLng];
  if (!bounds.every(Number.isFinite)
      || minLat > maxLat || minLng > maxLng
      || minLat < -90 || maxLat > 90 || minLng < -180 || maxLng > 180) {
    return json({ error: 'bad_bbox' }, 400);
  }

  // Round OUT to tile edges. The overhead shrinks as the query grows: a
  // 5-mile box roughly doubles, a 30-mile box grows by about a seventh.
  const y0 = Math.floor(minLat / TILE_DEG);
  const y1 = Math.floor(maxLat / TILE_DEG);
  const x0 = Math.floor(minLng / TILE_DEG);
  const x1 = Math.floor(maxLng / TILE_DEG);

  const south = y0 * TILE_DEG;
  const north = (y1 + 1) * TILE_DEG;
  const west = x0 * TILE_DEG;
  const east = (x1 + 1) * TILE_DEG;

  if (north - south > MAX_SPAN_DEG || east - west > MAX_SPAN_DEG) {
    return json({ error: 'bbox_too_large', maxSpanDeg: MAX_SPAN_DEG }, 413);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  // Skip the whole thing if another caller filled this area while this
  // request was in flight — two people opening onboarding in the same
  // town must not both pay Overpass.
  const wanted: { tile_y: number; tile_x: number }[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) wanted.push({ tile_y: y, tile_x: x });
  }

  const cutoff = new Date(Date.now() - TILE_TTL_DAYS * 86_400_000).toISOString();
  const { data: fresh } = await admin
    .from('osm_gym_tiles')
    .select('tile_y, tile_x')
    .gte('tile_y', y0).lte('tile_y', y1)
    .gte('tile_x', x0).lte('tile_x', x1)
    .gt('filled_at', cutoff);

  if ((fresh?.length ?? 0) >= wanted.length) {
    return json({ ok: true, filled: 0, tiles: wanted.length, cached: true });
  }

  const bbox = `(${south.toFixed(4)},${west.toFixed(4)},${north.toFixed(4)},${east.toFixed(4)})`;
  const q =
    `[out:json][timeout:${OVERPASS_TIMEOUT_S}];(` +
    GYM_SELECTORS.map((sel) => `nwr${sel}${bbox};`).join('') +
    `);out center 3000;`;

  let payload: { elements?: unknown[] };
  try {
    payload = await queryOverpass(q);
  } catch (err) {
    // Leave the tiles unmarked so the next caller retries. A tile marked
    // filled on a failed fetch is a permanent hole in the cache that
    // reads back as "no gyms here" for thirty days.
    return json({ error: 'overpass_failed', detail: String(err) }, 502);
  }

  type El = {
    type?: string; id?: number; lat?: number; lon?: number;
    center?: { lat: number; lon: number }; tags?: Record<string, string>;
  };

  const seen = new Set<string>();
  const rows = (payload.elements as El[] ?? [])
    .filter((el) => isGymLike(el.tags ?? {}))
    .map((el) => ({
      osm_type: el.type || 'node',
      osm_id: el.id,
      name: el.tags?.name || 'Gym',
      latitude: el.type === 'node' ? el.lat : el.center?.lat,
      longitude: el.type === 'node' ? el.lon : el.center?.lon,
      brand: el.tags?.brand ?? null,
      website: el.tags?.website ?? null,
      updated_at: new Date().toISOString(),
    }))
    .filter((r) => {
      if (r.osm_id == null || !r.latitude || !r.longitude) return false;
      const key = `${r.osm_type}/${r.osm_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (rows.length > 0) {
    const { error } = await admin
      .from('osm_gym_cache')
      .upsert(rows, { onConflict: 'osm_type,osm_id' });
    if (error) return json({ error: 'cache_write_failed', detail: error.message }, 500);
  }

  // Mark coverage only after the rows are in. The order matters: a tile
  // marked before its gyms land is a window where the cache confidently
  // reports an empty neighbourhood.
  const filledAt = new Date().toISOString();
  const { error: tileErr } = await admin
    .from('osm_gym_tiles')
    .upsert(
      wanted.map((t) => ({ ...t, filled_at: filledAt, gym_count: rows.length })),
      { onConflict: 'tile_y,tile_x' },
    );
  if (tileErr) return json({ error: 'tile_write_failed', detail: tileErr.message }, 500);

  return json({ ok: true, filled: rows.length, tiles: wanted.length, cached: false });
});
