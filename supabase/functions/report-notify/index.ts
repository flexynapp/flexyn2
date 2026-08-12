// supabase/functions/report-notify/index.ts
//
// Emails a moderator when a content report is filed.
//
// Sean, 12 Aug: "I don't know where these reports go… for right now send all
// reports to <address> but we're gonna replace that email eventually, and only
// send emails going forward. I don't care about past reports."
//
// Shape, and why:
//
//   • The DESTINATION arrives in the request body, read from the Vault by the
//     trigger that calls us. It is deliberately not an env var here, because
//     "we're gonna replace that email eventually" should be one SQL statement,
//     not a redeploy of this function.
//
//   • Forward-only falls out of using an AFTER INSERT trigger: there is no
//     backfill path and nothing reads historical rows. Existing reports stay
//     where they are.
//
//   • verify_jwt MUST be false. The caller is a database trigger via pg_net,
//     which has no user JWT — with the gateway check on, the request is
//     rejected before this handler's own auth runs. Same posture as send-push
//     and generateWeeklyDebriefs. Auth is the shared secret below.
//
// Deploy: the Supabase CLI cannot deploy from this repo (no config.toml — see
// CLAUDE.md). Use the MCP deploy_edge_function tool or the dashboard, then
// confirm with list_edge_functions that verify_jwt is false.

const RESEND_API_KEY   = Deno.env.get('RESEND_API_KEY') ?? '';
const SENDGRID_API_KEY = Deno.env.get('SENDGRID_API_KEY') ?? '';
const TRIGGER_SECRET   = Deno.env.get('REPORT_NOTIFY_SECRET') ?? '';
const FROM_ADDRESS     = Deno.env.get('REPORT_FROM_ADDRESS') ?? 'Flexyn Reports <reports@flexyn.app>';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-report-secret',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

async function sendEmail(to: string, subject: string, html: string, text: string) {
  if (RESEND_API_KEY) {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: FROM_ADDRESS, to: [to], subject, html, text }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}: ${await res.text()}`);
    return 'resend';
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
        from: { email: FROM_ADDRESS.replace(/^.*</, '').replace(/>$/, '') },
        subject,
        content: [{ type: 'text/plain', value: text }, { type: 'text/html', value: html }],
      }),
    });
    if (!res.ok) throw new Error(`sendgrid ${res.status}: ${await res.text()}`);
    return 'sendgrid';
  }
  throw new Error('no email provider configured');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Shared secret, not a JWT — the caller is a database trigger.
  if (!TRIGGER_SECRET || req.headers.get('x-report-secret') !== TRIGGER_SECRET) {
    return json({ error: 'unauthorized' }, 401);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }

  const to = String(body.to ?? '').trim();
  // A missing destination is a configuration problem, not a report problem.
  // 200 so pg_net does not retry a request that can never succeed, and so the
  // insert that triggered it is never implicated.
  if (!to) return json({ ok: true, skipped: 'no destination configured' });

  const r = (body.report ?? {}) as Record<string, unknown>;
  const type   = String(r.reported_type ?? 'content');
  const id     = String(r.reported_id ?? '—');
  const reason = String(r.reason ?? '—');
  const detail = r.detail ? String(r.detail) : '';
  const by     = String(r.reporter_email ?? '—');
  const author = r.reported_author_email ? String(r.reported_author_email) : '—';
  const at     = String(r.created_at ?? '');

  const subject = `[Flexyn] ${type} reported — ${reason}`;
  const text = [
    `A ${type} was reported on Flexyn.`,
    ``,
    `Reason:    ${reason}`,
    detail ? `Details:   ${detail}` : ``,
    `Type:      ${type}`,
    `Content:   ${id}`,
    `Author:    ${author}`,
    `Reported by: ${by}`,
    at ? `When:      ${at}` : ``,
    ``,
    `Review in the admin queue: /admin-reports`,
  ].filter(Boolean).join('\n');

  const html = `
    <div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px">
      <h2 style="margin:0 0 4px">${escapeHtml(type)} reported</h2>
      <p style="margin:0 0 16px;color:#667484">${escapeHtml(reason)}</p>
      ${detail ? `<blockquote style="margin:0 0 16px;padding:8px 12px;border-left:3px solid #d0d7e2;color:#333">${escapeHtml(detail)}</blockquote>` : ''}
      <table style="border-collapse:collapse;font-size:14px">
        <tr><td style="padding:2px 12px 2px 0;color:#667484">Type</td><td>${escapeHtml(type)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#667484">Content</td><td><code>${escapeHtml(id)}</code></td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#667484">Author</td><td>${escapeHtml(author)}</td></tr>
        <tr><td style="padding:2px 12px 2px 0;color:#667484">Reported by</td><td>${escapeHtml(by)}</td></tr>
        ${at ? `<tr><td style="padding:2px 12px 2px 0;color:#667484">When</td><td>${escapeHtml(at)}</td></tr>` : ''}
      </table>
      <p style="margin:20px 0 0"><a href="https://flexyn.app/admin-reports">Open the admin queue</a></p>
    </div>`;

  try {
    const provider = await sendEmail(to, subject, html, text);
    return json({ ok: true, provider });
  } catch (err) {
    // 500 so the failure is visible in net._http_response rather than silently
    // recorded as a success — that is exactly how the weekly-debrief cron
    // 404'd every Sunday for ten weeks without anyone noticing.
    return json({ ok: false, error: String((err as Error)?.message ?? err) }, 500);
  }
});
