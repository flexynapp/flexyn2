# Deploy Pending — 5-minute walkthrough

Everything below ships the SQL + Edge Function I built this session. Do steps 1 + 2 to unlock the social/gamification/cycle features. Do step 3 (optional) to enable Photo-AI meal recognition.

---

## Step 1 — Run the migrations (2 minutes)

This turns on coin gifting, monthly leaderboards, emoji reactions, notification snooze, cycle tracking, and the onboarding fitness assessment.

1. Open **Supabase Dashboard** → your Flexyn project
2. Click **SQL Editor** in the left sidebar
3. Click **New query**
4. Open the file `supabase/migrations/_deploy_pending.sql` in your editor (or on GitHub) and copy the WHOLE file
5. Paste into the SQL Editor
6. Click the green **Run** button (bottom right) or hit `Cmd/Ctrl + Enter`
7. Wait for **"Success. No rows returned"** — should take 1–2 seconds

The bundle is idempotent — if any of those migrations already ran, the `IF NOT EXISTS` / `CREATE OR REPLACE` guards make a second run a no-op. Safe to paste even if you're unsure what state things are in.

**To verify it worked**, run this in the same SQL Editor:

```sql
SELECT
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'gift_flex_coins')               AS gift_coins,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_period_leaderboard')        AS period_lb,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_post_emoji_reaction')       AS emoji_rxn,
  EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'snooze_notification_category')  AS snooze,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'cycle_logs') AS cycle,
  EXISTS (SELECT 1 FROM information_schema.columns
          WHERE table_name = 'user_profiles' AND column_name = 'fitness_assessment') AS assessment;
```

All 6 should return `true`. If any return `false`, that migration didn't apply — re-paste the section for that one from `_deploy_pending.sql`.

---

## Step 2 — Wait for the next app deploy (automatic)

You don't have to do anything. The next time the site rebuilds and deploys (whichever way you ship — Vercel auto-deploys on push to main, etc.), the new client UI that calls these RPCs will go live alongside.

---

## Step 3 (optional) — Enable Photo-AI meal recognition

Only do this if you want the 📸 button on the Nutrition page to actually identify meals from photos. The button visibly exists right now but shows "Photo recognition isn't enabled yet" until you do this.

You need:
- An Anthropic API key from https://console.anthropic.com/settings/keys
- The Supabase CLI (`brew install supabase/tap/supabase` on Mac, or `scoop install supabase` on Windows)

Then run from the repo root:

```bash
# One-time login (opens a browser tab)
supabase login

# Link this folder to your Supabase project (one-time)
supabase link --project-ref <your-project-ref>

# Set the Anthropic key as a function secret
supabase secrets set ANTHROPIC_API_KEY="sk-ant-..."

# Deploy the function
supabase functions deploy recognize-meal
```

The `<your-project-ref>` is the slug in your Supabase dashboard URL — e.g. if your dashboard is at `https://supabase.com/dashboard/project/abc123xyz`, the ref is `abc123xyz`.

---

## Already-pending older deploys (separate, you may have done these already)

These were noted as pending from before this session — not part of the new bundle:

- **Push notifications** — needs VAPID keys + `supabase functions deploy send-push` + `app.send_push_url` setting. Full checklist in `CLAUDE.md` under "Push notifications".
- **Weekly debriefs cron** — needs `supabase functions deploy generateWeeklyDebriefs` + `app.debrief_func_url` setting.

If you already did these, ignore. If not, the relevant feature stays dormant (push fanout silently no-ops, debriefs show stale data).

---

## Can your partner do this?

If they have **Owner** or **Admin** role on the Supabase project, yes — they can do all of step 1 from their browser without any CLI. Step 3 requires CLI access + the Anthropic API key.

If they're only a git collaborator (no Supabase dashboard access), they can't deploy these — only you can.
