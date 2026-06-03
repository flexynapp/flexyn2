-- 172_guest_signin_support.sql
--
-- Beta access: anonymous sign-in for testers who can't (or don't
-- want to) deal with email magic-link / OAuth friction. Pairs with
-- the "Continue as guest" button in SignInToContinue.jsx, which
-- calls supabase.auth.signInAnonymously() from the client.
--
-- Supabase's signInAnonymously creates an auth.users row with
-- email = NULL. The existing handle_new_user trigger (mig 001)
-- inserts into public.user_profiles using NEW.email — for anon
-- users that NULL would propagate, and the rest of the app would
-- read user.email as null which breaks every `created_by`
-- assumption (every table has `created_by text not null` and the
-- client-side db.entities.X.create auto-injects authUser.email).
--
-- Fix: synthesize a stable placeholder email for guests so the
-- app's email-keyed identity layer keeps working without
-- special-casing every read/write site. Placeholders look like
-- `guest_<uuid>@flexyn.guest` — the @flexyn.guest TLD doesn't
-- resolve, so no real mail ever flies, but the column has a
-- value and joins/eq filters still work.
--
-- Notes:
--   • Real email signups (Google / Apple / magic link) still write
--     the actual email — only NULL.email rows fall back.
--   • A guest later linking an OAuth provider keeps the same
--     auth.users.id, so we leave their user_profiles.email as the
--     placeholder until they explicitly upgrade. (UpgradeGuest
--     flow is a follow-up; for now beta testers reset on release
--     per kegan's instruction.)
--
-- ANNOUNCE TO DASHBOARD: this migration assumes anonymous sign-in
-- is ALSO enabled in the Supabase dashboard:
--   Project → Authentication → Providers → Email → "Enable
--   anonymous sign-ins" toggle.
-- Without that, signInAnonymously() returns a 422; the button will
-- surface a toast saying so.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  -- Pulled into scalars up front so the SQL stays paste-safe — the
  -- chat → Supabase SQL Editor clipboard pipeline mangles
  -- record-field `.<field>` tokens inside string concatenation
  -- (`'guest_' || NEW.id || '@flexyn.guest'` came back as
  -- `<NEW.id>`, 42601). Each NEW.<field> read sits on its own
  -- assignment line and the placeholder is built with format(),
  -- not the `||` operator the pipeline also chokes on.
  v_id     UUID;
  v_email  TEXT;
  v_meta   JSONB;
BEGIN
  v_id    := NEW.id;
  v_email := NEW.email;
  v_meta  := NEW.raw_user_meta_data;

  IF v_email IS NULL THEN
    v_email := format('guest_%s@flexyn.guest', v_id);
  END IF;

  INSERT INTO public.user_profiles (id, email, full_name, avatar_url)
  VALUES (
    v_id,
    v_email,
    v_meta->>'full_name',
    v_meta->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
END;
$$;

-- Defensive backfill: any pre-existing user_profiles row with
-- email IS NULL (created before this migration on a host that
-- already had anonymous auth on) gets a placeholder.
UPDATE public.user_profiles
   SET email = format('guest_%s@flexyn.guest', id)
 WHERE email IS NULL;

NOTIFY pgrst, 'reload schema';
