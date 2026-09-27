// supabase/functions/generate-weekly-debriefs/index.ts
//
// Weekly Reviews — the scheduled generator. Invoked by pg_cron on Sunday
// evening; also callable by hand with a service-role token for a backfill.
//
// ── WHY THIS FILE IS NOW 150 LINES INSTEAD OF 456 ──────────────────────────
//
// It used to compute the whole review itself in TypeScript: its own volume
// sum, its own XP formula (sets*12 + rep tiers + duration), its own muscle-
// group keyword matcher, its own PR detection. `generate_my_weekly_debrief`
// computed the same review in SQL, differently. Two implementations of one
// thing, and they disagreed — the same week showed different XP depending on
// which one ran last, and whichever ran second overwrote the first.
//
// That is not a bug you fix by porting the v2 formula into TypeScript, which
// just recreates the divergence one release later. There is now exactly ONE
// body, `public.generate_weekly_review_for(p_user_id, p_week_start)`, and
// this function calls it once per active user. The client's
// `generate_my_weekly_review()` is a wrapper over the same body with
// auth.uid() bound. They cannot drift because there is nothing to drift from.
//
// So: no arithmetic in this file, on purpose. If a number is wrong, it is
// wrong in the SQL and it is wrong identically on both paths. Do not add a
// calculation here to "fix" something.
//
// ── Auth ───────────────────────────────────────────────────────────────────
//   X-Cron-Secret: <DEBRIEF_CRON_SECRET>       (pg_cron)
//   Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY, compared exactly>  (manual / backfill)
// verify_jwt is deliberately FALSE: the cron authenticates with the header
// above, and a gateway JWT check would reject it before this handler's own
// auth gate runs. Same posture as send-push.
//
// ── Body (all optional) ────────────────────────────────────────────────────
//   { "week_start": "YYYY-MM-DD",   // defaults to the current ISO week
//     "push": false }               // defaults to true
//
// ── Env ────────────────────────────────────────────────────────────────────
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  — provided by the runtime
//   DEBRIEF_CRON_SECRET                      — required for the cron path
//   SEND_PUSH_TRIGGER_SECRET                 — optional; without it, no push

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false } }
);

/** Monday of the ISO week containing `date`, as YYYY-MM-DD. The RPC derives
 *  the week number, the year and the end date from this one value, so it is
 *  the only date arithmetic left in this file. */
function isoMonday(date: Date): string {
  const day = date.getUTCDay();                       // 0 = Sunday
  const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), diff))
    .toISOString().split('T')[0];
}

const safeEqual = (a: string, b: string) => {
  if (a.length !== b.length || a.length === 0) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
};

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), { status: 405 });
  }

  // Cron secret, or a genuine service-role token. A 2026-06 audit found this
  // accepting ANY non-empty Bearer, which the public anon key satisfied —
  // letting anyone trigger the full generation loop and push fan-out.
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const cronSecret = Deno.env.get('DEBRIEF_CRON_SECRET') || '';
  const incoming = req.headers.get('x-cron-secret') || '';
  const bearer = ((req.headers.get('authorization') || '').match(/^Bearer\s+(\S+)/i) || [])[1] || '';
  // SECURITY (2026-09-27 audit): an unverified role=service_role claim in the
  // Bearer payload used to count as authorised. verify_jwt is off here, so a
  // hand-made token could run the whole loop and push to every active user.
  // Only the cron secret or the exact service key authorise now.
  const authorised = (cronSecret.length > 0 && safeEqual(incoming, cronSecret))
    || (serviceRoleKey.length > 0 && safeEqual(bearer, serviceRoleKey));

  if (!authorised) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 });
  }

  let body: { week_start?: string; push?: boolean } = {};
  try { body = await req.json(); } catch { /* empty body is the cron's normal case */ }

  const weekStart = body.week_start || isoMonday(new Date());
  // Date.UTC takes a ZERO-BASED month, so the month from the YYYY-MM-DD split
  // has to be decremented — passing it straight through lands a month late.
  const [wy, wm, wd] = weekStart.split('-').map(Number);
  const weekEndStr = new Date(Date.UTC(wy, wm - 1, wd + 6))  // Monday + 6 = Sunday
    .toISOString().split('T')[0];

  // ── Who had a week worth reviewing ────────────────────────────────────────
  // Widened past workouts + nutrition: the v2 review also reports cardio,
  // steps, sleep and mood, so someone who logged only a run had a real week
  // and used to get nothing. The RPC's own no-activity guard is the backstop
  // — it declines to create a row for a genuinely empty week — so an
  // over-broad list here costs a wasted call, not a junk review.
  const tables = ['workout_logs', 'cardio_logs', 'nutrition_logs', 'step_logs', 'sleep_logs', 'mood_logs'];
  const found = await Promise.all(tables.map(t =>
    supabase.from(t).select('user_id').gte('date', weekStart).lte('date', weekEndStr)
  ));

  const userIds = new Set<string>();
  for (const { data, error } of found) {
    if (error) { console.warn('[review] active-user scan failed:', error.message); continue; }
    for (const row of (data || [])) if (row.user_id) userIds.add(row.user_id as string);
  }

  if (userIds.size === 0) {
    return new Response(JSON.stringify({ ok: true, week_start: weekStart, generated: 0, reason: 'no_active_users' }),
      { headers: { 'Content-Type': 'application/json' } });
  }

  // ── Generate ──────────────────────────────────────────────────────────────
  const pushSecret = Deno.env.get('SEND_PUSH_TRIGGER_SECRET') || '';
  const wantPush = body.push !== false && pushSecret.length > 0;
  const pushUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`;

  let generated = 0, skipped = 0;
  const failed: string[] = [];

  for (const userId of userIds) {
    try {
      const { data, error } = await supabase.rpc('generate_weekly_review_for', {
        p_user_id: userId,
        p_week_start: weekStart,
      });
      if (error) throw error;

      // The RPC declines empty weeks rather than filing a 0-lbs review under
      // someone's name. Nothing to announce when it does.
      if (data?.skipped) { skipped++; continue; }
      generated++;

      if (!wantPush) continue;
      const t = data?.data?.training ?? {};
      const sessions = Number(t.sessions ?? 0);
      const volume = Math.round(Number(t.volume_lbs ?? 0));
      const parts: string[] = [];
      if (sessions > 0) parts.push(`${sessions} session${sessions === 1 ? '' : 's'}`);
      if (volume > 0) parts.push(`${volume.toLocaleString('en-US')} lbs`);
      if (t.top_lift?.is_pr && t.top_lift?.name) parts.push(`New PR on ${t.top_lift.name}!`);

      await fetch(pushUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-send-push-secret': pushSecret },
        body: JSON.stringify({
          user_id: userId,
          title: `🏋️ ${data?.week_label ?? 'Your week'} is ready`,
          body: parts.length ? parts.join(' · ') : 'Your weekly review is ready.',
          url: '/profile?debrief=true',
          tag: `weekly-review-${weekStart}`,
        }),
      }).catch(e => console.warn('[review] push failed:', e));
    } catch (err) {
      console.error(`[review] failed for ${userId}:`, err);
      failed.push(userId);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, week_start: weekStart, week_end: weekEndStr,
                     considered: userIds.size, generated, skipped, failed: failed.length }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
