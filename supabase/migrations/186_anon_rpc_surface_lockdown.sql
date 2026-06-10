-- Migration 186: remove the anon RPC surface from cross-user notify + trigger bodies
--
-- The advisor flags ~80 SECURITY DEFINER functions as anon-executable. Most
-- are SAFE to leave: they gate on auth.uid() (anon = NULL → they no-op/raise),
-- OR they are RLS helpers (is_blocked, is_crew_member, is_app_admin, …) that
-- MUST stay anon-executable because anon evaluates them inside RLS policies
-- (e.g. mig 178's hub_posts policy calls is_blocked) — revoking those would
-- break anon reads of public profiles/posts/gyms. The public duel-invite
-- reader (get_pending_duel_invite_public) is intentionally anon too.
--
-- This migration closes only the genuinely-unsafe anon surface:
--
--   A. Cross-user NOTIFY functions — create_notification_for + the
--      notify_*_for family. Anon has no business inserting notifications
--      into other users' inboxes (spam / spoofed "verify your account"
--      phishing once push is live). Revoked from PUBLIC, re-granted to
--      authenticated (the client data layer calls these after a social
--      action). Internal SECURITY DEFINER callers run as postgres and are
--      unaffected. (Hardening title/body/link rendering server-side per
--      type — audit C21 — remains a separate follow-up.)
--
--   B. Pure TRIGGER bodies that were never meant to be RPCs — revoked from
--      PUBLIC entirely. Triggers fire as the table owner and ignore the
--      EXECUTE grant, so the triggers keep working; only the /rest/v1/rpc/
--      surface is removed (same rationale as mig 185's `_`-prefixed set).
--
-- REVOKE-from-PUBLIC-then-GRANT pattern is used so anon loses access
-- regardless of whether the original grant was TO PUBLIC or TO anon.
-- All signatures verified against prod (2026-06-10).

-- ── A. cross-user notify functions: PUBLIC → authenticated only ──────────────
REVOKE ALL ON FUNCTION public.create_notification_for(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_notification_for(uuid, text, text, text, text, text, jsonb) TO authenticated;

REVOKE ALL ON FUNCTION public.notify_bounty_beaten_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_bounty_beaten_for(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.notify_bounty_claim_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_bounty_claim_for(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.notify_comment_reply_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_comment_reply_for(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.notify_crew_war_resolved_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_crew_war_resolved_for(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.notify_crew_war_started_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_crew_war_started_for(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.notify_duel_invite_for(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_duel_invite_for(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.notify_duel_result_for(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_duel_result_for(uuid, uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.notify_friend_follow_for(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_friend_follow_for(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.notify_friend_post_for(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_friend_post_for(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.notify_league_resolution_for(uuid, text, text, text, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_league_resolution_for(uuid, text, text, text, integer, text) TO authenticated;

REVOKE ALL ON FUNCTION public.notify_nemesis_assigned_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.notify_nemesis_assigned_for(uuid) TO authenticated;

-- ── B. pure trigger bodies: no RPC surface for anyone ────────────────────────
REVOKE ALL ON FUNCTION public.auto_accept_on_send()        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.bump_item_sold_count()       FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_review_adoption()    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_dm_received()         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notify_report_resolved()     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_scheduled_messages() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rls_auto_enable()            FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
