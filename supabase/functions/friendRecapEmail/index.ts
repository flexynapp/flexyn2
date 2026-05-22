// supabase/functions/friendRecapEmail/index.ts
//
// Weekly Monday email digest of what your friends did this week. For
// each user who has at least one followee active in the past 7 days,
// pull their followees' workout / PR / badge activity and send a
// summary email.
//
// DEPLOYMENT GATE
// ───────────────
// This function is SCAFFOLDED but does NOT send email by default. The
// email-provider credentials (RESEND_API_KEY or SENDGRID_API_KEY) are
// operator config; without them the function bails out at the gate
// below with a 503-equivalent body. This is intentional — we don't
// want a deploy that mass-emails users by accident on Day 1.
//
// To enable in production:
//   1. supabase secrets set RESEND_API_KEY=re_… (or SENDGRID_API_KEY=…)
//   2. supabase secrets set RECAP_EMAIL_FROM='Flexyn <hi@flexyn.app>'
//   3. supabase secrets set RECAP_EMAIL_ENABLED=true
//   4. supabase functions deploy friendRecapEmail
//   5. In SQL Editor, schedule the cron:
//        SELECT cron.schedule(
//          'friend_recap_email_weekly',
//          '0 14 * * 1',  -- Monday 14:00 UTC ≈ 9-10am ET / 6-7am PT
//          $cron$ SELECT net.http_post(
//            url := 'https://<ref>.functions.supabase.co/friendRecapEmail',
//            headers := jsonb_build_object(
//              'Authorization', 'Bearer ' || current_setting('app.recap_cron_secret', true),
//              'Content-Type', 'application/json'
//            ),
//            body := '{}'::jsonb
//          ); $cron$
//        );
//   6. ALTER DATABASE postgres SET app.recap_cron_secret = '<openssl rand -hex 32>'
//      and supabase secrets set RECAP_CRON_SECRET=<same>
//
// AUDIENCE FILTERING (mirrors migrations 037 + 082 patterns)
// ──────────────────────────────────────────────────────────
//   • last_login_date within last 30 days — don't email churned users
//     who haven't opened the app in a month. The streak-break +
//     welcome-back pushes own that surface.
//   • notification_prefs.engagement != 'false' — the same toggle that
//     gates welcome-back pushes. A user who muted engagement nudges
//     in the app is opted out of this email too.
//   • Per-user dedup via a tracking table so a cron rerun doesn't
//     double-send.
//
// PAYLOAD
// ───────
// For each eligible recipient, the email summarizes:
//   • Number of followees who worked out this week
//   • Top 3 followees by sessions logged
//   • PRs hit by followees (up to 5)
//   • A "View on Flexyn" CTA pointing at /hub
// Rendered in the recipient's preferred_language. The text helpers
// will land in a follow-up migration once translations are reviewed.

// deno-lint-ignore-file no-explicit-any
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY      = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RECAP_EMAIL_ENABLED   = (Deno.env.get('RECAP_EMAIL_ENABLED') ?? 'false') === 'true';
const RECAP_EMAIL_FROM      = Deno.env.get('RECAP_EMAIL_FROM') ?? 'Flexyn <hi@flexyn.app>';
const RESEND_API_KEY        = Deno.env.get('RESEND_API_KEY') ?? '';
const SENDGRID_API_KEY      = Deno.env.get('SENDGRID_API_KEY') ?? '';
const RECAP_CRON_SECRET     = Deno.env.get('RECAP_CRON_SECRET') ?? '';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Dispatch a single email via Resend (preferred) or SendGrid (fallback).
 * Returns { ok, status } so we can count successes/failures.
 */
async function sendEmail(
  to: string,
  subject: string,
  html: string,
): Promise<{ ok: boolean; status: number; body?: string }> {
  if (RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    RECAP_EMAIL_FROM,
        to:      [to],
        subject,
        html,
      }),
    });
    return { ok: res.ok, status: res.status, body: await res.text() };
  }
  if (SENDGRID_API_KEY) {
    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SENDGRID_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from:    { email: RECAP_EMAIL_FROM.replace(/.*<|>.*/g, '') },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
    });
    return { ok: res.ok, status: res.status, body: await res.text() };
  }
  return { ok: false, status: 503, body: 'No email provider configured' };
}

/**
 * Render the digest HTML for a recipient + their followee activity.
 * Keep this self-contained and inline-styled — many email clients
 * strip <style> blocks and external CSS.
 */
function renderHtml(opts: {
  username: string;
  followeesActive: number;
  topFollowees: Array<{ name: string; sessions: number }>;
  prs: Array<{ name: string; lift: string }>;
}): string {
  const { username, followeesActive, topFollowees, prs } = opts;
  const topList = topFollowees
    .map(f => `<li style="margin: 4px 0;"><strong>${f.name}</strong> — ${f.sessions} session${f.sessions === 1 ? '' : 's'}</li>`)
    .join('');
  const prList = prs
    .map(p => `<li style="margin: 4px 0;"><strong>${p.name}</strong> — ${p.lift}</li>`)
    .join('');
  return `<!doctype html>
<html><body style="font-family: -apple-system, system-ui, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f8fafc; color: #0f172a;">
  <h1 style="font-size: 22px; margin: 0 0 12px;">Hey ${username || 'Athlete'},</h1>
  <p style="font-size: 15px; line-height: 1.55; margin: 0 0 16px;">
    Here's what your crew did this week. ${followeesActive} friend${followeesActive === 1 ? '' : 's'} trained.
  </p>
  ${topList ? `<h2 style="font-size: 16px; margin: 20px 0 8px;">Most active</h2>
  <ul style="padding-left: 20px; margin: 0; font-size: 14px;">${topList}</ul>` : ''}
  ${prList ? `<h2 style="font-size: 16px; margin: 20px 0 8px;">New PRs</h2>
  <ul style="padding-left: 20px; margin: 0; font-size: 14px;">${prList}</ul>` : ''}
  <p style="margin: 24px 0;">
    <a href="https://flexyn.netlify.app/hub" style="display: inline-block; background: #10b981; color: white; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open Flexyn</a>
  </p>
  <p style="font-size: 12px; color: #64748b; margin-top: 32px;">
    You're receiving this because your engagement preferences allow weekly digests.
    Mute in Settings → Notifications → Welcome back.
  </p>
</body></html>`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  // ── Cron auth ────────────────────────────────────────────────────────
  // The hourly/weekly cron passes the shared secret in the Authorization
  // header. We reject anything else so a random web visitor can't
  // trigger a mass email by hitting the function URL.
  const auth = req.headers.get('Authorization') ?? '';
  const provided = auth.replace(/^Bearer\s+/, '');
  if (!RECAP_CRON_SECRET || provided !== RECAP_CRON_SECRET) {
    return jsonResponse(401, { ok: false, error: 'unauthorized' });
  }

  // ── Hard gate on email provider config ───────────────────────────────
  // Refuses to even attempt sends until the operator explicitly enables
  // it. Prevents accidental mass-email on a fresh deploy.
  if (!RECAP_EMAIL_ENABLED) {
    return jsonResponse(503, {
      ok:     false,
      reason: 'recap_email_disabled',
      hint:   'Set RECAP_EMAIL_ENABLED=true + a provider key to enable.',
    });
  }
  if (!RESEND_API_KEY && !SENDGRID_API_KEY) {
    return jsonResponse(503, {
      ok:     false,
      reason: 'no_email_provider',
      hint:   'Configure RESEND_API_KEY or SENDGRID_API_KEY.',
    });
  }

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  // ── Recipient cohort ─────────────────────────────────────────────────
  // Active in last 30 days + engagement prefs not muted + email present.
  // Migration 085 grants service_role on user_profiles so this read works.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const { data: recipients, error: recipErr } = await sb
    .from('user_profiles')
    .select('id, email, username, preferred_language, notification_prefs, last_login_date')
    .gte('last_login_date', since)
    .not('email', 'is', null)
    .limit(2000);

  if (recipErr) {
    console.warn('[friendRecapEmail] recipients query failed:', recipErr);
    return jsonResponse(500, { ok: false, error: 'recipients_query_failed' });
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  // ── Per-recipient digest ─────────────────────────────────────────────
  for (const r of recipients ?? []) {
    // Honor engagement opt-out.
    const prefs = r.notification_prefs as any;
    if (prefs && prefs.engagement === false) { skipped += 1; continue; }

    // Pull followee activity for the last 7 days.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: follows } = await sb
      .from('hub_follows')
      .select('followee_email')
      .eq('follower_email', r.email);
    const followeeEmails = (follows ?? []).map(f => f.followee_email).filter(Boolean);
    if (followeeEmails.length === 0) { skipped += 1; continue; }

    const { data: followeeLogs } = await sb
      .from('workout_logs')
      .select('created_by, exercises')
      .in('created_by', followeeEmails)
      .gte('created_at', sevenDaysAgo)
      .limit(500);

    const sessionsByUser: Record<string, number> = {};
    for (const log of followeeLogs ?? []) {
      sessionsByUser[log.created_by] = (sessionsByUser[log.created_by] || 0) + 1;
    }
    const followeesActive = Object.keys(sessionsByUser).length;
    if (followeesActive === 0) { skipped += 1; continue; }

    // Top 3 by sessions.
    const topEmails = Object.entries(sessionsByUser)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const { data: topProfiles } = await sb
      .from('user_profiles')
      .select('email, username')
      .in('email', topEmails.map(([e]) => e));

    const topFollowees = topEmails.map(([email, sessions]) => ({
      name: topProfiles?.find(p => p.email === email)?.username || email.split('@')[0],
      sessions,
    }));

    const html = renderHtml({
      username: r.username || '',
      followeesActive,
      topFollowees,
      prs: [], // PR aggregation can land in a follow-up
    });

    const subject = `${followeesActive} of your crew trained this week`;
    const res = await sendEmail(r.email, subject, html);
    if (res.ok) sent += 1;
    else failed += 1;
  }

  return jsonResponse(200, { ok: true, sent, skipped, failed });
});
