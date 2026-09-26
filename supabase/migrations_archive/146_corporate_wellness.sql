-- 146_corporate_wellness.sql
--
-- Corporate Wellness Portal — a B2B org tenant layered over the
-- existing gamification stack. Companies group employees into an
-- organization, run private org-only challenges, and (for org admins)
-- view a READ-ONLY, privacy-preserving HR analytics dashboard.
--
-- PRIVACY MODEL (the whole pitch): the HR dashboard exposes only
-- AGGREGATES (counts / %, averages) via a SECURITY DEFINER RPC. No
-- per-employee rows are ever returned to an admin, and aggregates are
-- suppressed below a small-cohort floor so a stat can't single out one
-- person.
--
-- Membership checks use SECURITY DEFINER helpers so RLS policies on
-- organization_members don't recurse into themselves.
--
-- Idempotent throughout.

-- ── Tables ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL,
    owner_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    join_code   TEXT UNIQUE NOT NULL,
    seat_limit  INTEGER,                          -- nullable; per-seat billing story
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
    id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id    UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id   UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role      TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
    joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (org_id, user_id)
);
CREATE INDEX IF NOT EXISTS organization_members_user_idx ON public.organization_members (user_id);
CREATE INDEX IF NOT EXISTS organization_members_org_idx  ON public.organization_members (org_id);

CREATE TABLE IF NOT EXISTS public.organization_challenges (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id       UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    metric       TEXT NOT NULL CHECK (metric IN ('workouts', 'active_days', 'volume', 'streak', 'hydration')),
    target_value NUMERIC NOT NULL DEFAULT 0,
    starts_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    ends_at      TIMESTAMPTZ,
    created_by   UUID NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS organization_challenges_org_idx ON public.organization_challenges (org_id, created_at DESC);

-- ── Membership helpers (SECURITY DEFINER → no RLS recursion) ────────
CREATE OR REPLACE FUNCTION public.is_org_member(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members
                  WHERE org_id = p_org_id AND user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.organization_members
                  WHERE org_id = p_org_id AND user_id = auth.uid() AND role = 'admin');
$$;

GRANT EXECUTE ON FUNCTION public.is_org_member(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_admin(UUID)  TO authenticated;

-- ── RLS ─────────────────────────────────────────────────────────────
ALTER TABLE public.organizations          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_challenges ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org: members read"   ON public.organizations;
DROP POLICY IF EXISTS "org: admin update"   ON public.organizations;
DROP POLICY IF EXISTS "org: owner delete"   ON public.organizations;
CREATE POLICY "org: members read" ON public.organizations FOR SELECT TO authenticated
  USING (public.is_org_member(id));
CREATE POLICY "org: admin update" ON public.organizations FOR UPDATE TO authenticated
  USING (public.is_org_admin(id)) WITH CHECK (public.is_org_admin(id));
CREATE POLICY "org: owner delete" ON public.organizations FOR DELETE TO authenticated
  USING (owner_id = auth.uid());
GRANT SELECT, UPDATE, DELETE ON public.organizations TO authenticated;

DROP POLICY IF EXISTS "org_members: read same org"  ON public.organization_members;
DROP POLICY IF EXISTS "org_members: leave own"      ON public.organization_members;
CREATE POLICY "org_members: read same org" ON public.organization_members FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_org_member(org_id));
-- Members can remove themselves; admins manage via RPC. No direct
-- INSERT policy — joining goes through join_organization_by_code.
CREATE POLICY "org_members: leave own" ON public.organization_members FOR DELETE TO authenticated
  USING (user_id = auth.uid());
GRANT SELECT, DELETE ON public.organization_members TO authenticated;

DROP POLICY IF EXISTS "org_challenges: members read" ON public.organization_challenges;
DROP POLICY IF EXISTS "org_challenges: admin write"  ON public.organization_challenges;
DROP POLICY IF EXISTS "org_challenges: admin update" ON public.organization_challenges;
DROP POLICY IF EXISTS "org_challenges: admin delete" ON public.organization_challenges;
CREATE POLICY "org_challenges: members read" ON public.organization_challenges FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));
CREATE POLICY "org_challenges: admin write" ON public.organization_challenges FOR INSERT TO authenticated
  WITH CHECK (public.is_org_admin(org_id) AND created_by = auth.uid());
CREATE POLICY "org_challenges: admin update" ON public.organization_challenges FOR UPDATE TO authenticated
  USING (public.is_org_admin(org_id)) WITH CHECK (public.is_org_admin(org_id));
CREATE POLICY "org_challenges: admin delete" ON public.organization_challenges FOR DELETE TO authenticated
  USING (public.is_org_admin(org_id));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.organization_challenges TO authenticated;

-- ── Create org (mints a unique join code, adds creator as admin) ────
CREATE OR REPLACE FUNCTION public.create_organization(p_name TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_code TEXT;
  v_org  UUID;
  v_try  INT := 0;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  IF COALESCE(btrim(p_name), '') = '' THEN RETURN jsonb_build_object('ok', false, 'error', 'NAME_REQUIRED'); END IF;

  -- Mint an 8-char code (no ambiguous chars), retry on collision.
  LOOP
    v_try := v_try + 1;
    v_code := upper(translate(substr(encode(gen_random_bytes(8), 'base32'), 1, 8), 'OISBoisb', '01258012'));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.organizations WHERE join_code = v_code);
    IF v_try > 12 THEN RAISE EXCEPTION 'could not mint code'; END IF;
  END LOOP;

  INSERT INTO public.organizations (name, owner_id, join_code)
    VALUES (btrim(p_name), v_uid, v_code)
    RETURNING id INTO v_org;
  INSERT INTO public.organization_members (org_id, user_id, role)
    VALUES (v_org, v_uid, 'admin')
    ON CONFLICT (org_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'org_id', v_org, 'join_code', v_code);
END;
$$;
REVOKE ALL ON FUNCTION public.create_organization(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organization(TEXT) TO authenticated;

-- ── Join by code ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_organization_by_code(p_code TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_org UUID;
  v_cnt INT;
  v_lim INT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT id, seat_limit INTO v_org, v_lim
    FROM public.organizations WHERE join_code = upper(btrim(p_code));
  IF v_org IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CODE_NOT_FOUND'); END IF;

  IF v_lim IS NOT NULL THEN
    SELECT COUNT(*) INTO v_cnt FROM public.organization_members WHERE org_id = v_org;
    IF v_cnt >= v_lim AND NOT EXISTS (
      SELECT 1 FROM public.organization_members WHERE org_id = v_org AND user_id = v_uid
    ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'SEATS_FULL');
    END IF;
  END IF;

  INSERT INTO public.organization_members (org_id, user_id, role)
    VALUES (v_org, v_uid, 'member')
    ON CONFLICT (org_id, user_id) DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'org_id', v_org);
END;
$$;
REVOKE ALL ON FUNCTION public.join_organization_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.join_organization_by_code(TEXT) TO authenticated;

-- ── HR analytics (aggregate-only, admin-gated, privacy floor) ───────
-- Returns ONLY counts / %, never per-employee data. Reads members'
-- workout_logs via SECURITY DEFINER (RLS would otherwise block
-- cross-user reads) but emits aggregates exclusively.
CREATE OR REPLACE FUNCTION public.get_org_analytics(p_org_id UUID)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_members      INT := 0;
  v_active_7d    INT := 0;
  v_workouts_7d  INT := 0;
  v_avg_streak   NUMERIC := 0;
  v_min_cohort   CONSTANT INT := 3;  -- suppress fine detail below this
BEGIN
  IF NOT public.is_org_admin(p_org_id) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*) INTO v_members FROM public.organization_members WHERE org_id = p_org_id;

  IF v_members < v_min_cohort THEN
    RETURN jsonb_build_object(
      'members', v_members,
      'cohort_too_small', true,
      'min_cohort', v_min_cohort
    );
  END IF;

  SELECT COUNT(DISTINCT user_id), COUNT(*)
    INTO v_active_7d, v_workouts_7d
    FROM public.workout_logs
   WHERE created_at > now() - INTERVAL '7 days'
     AND user_id IN (SELECT user_id FROM public.organization_members WHERE org_id = p_org_id);

  SELECT COALESCE(AVG(COALESCE(workout_streak, 0)), 0)
    INTO v_avg_streak
    FROM public.user_profiles
   WHERE id IN (SELECT user_id FROM public.organization_members WHERE org_id = p_org_id);

  RETURN jsonb_build_object(
    'members',           v_members,
    'active_7d',         v_active_7d,
    'workouts_7d',       v_workouts_7d,
    'avg_workout_streak', ROUND(v_avg_streak, 1),
    'participation_pct', CASE WHEN v_members > 0 THEN ROUND(100.0 * v_active_7d / v_members, 0) ELSE 0 END,
    'cohort_too_small',  false
  );
END;
$$;
REVOKE ALL ON FUNCTION public.get_org_analytics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_analytics(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
