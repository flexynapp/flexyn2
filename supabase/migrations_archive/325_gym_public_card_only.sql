-- ── 325 · a signed-out visitor gets a card, not the table ───────────
--
-- gym_businesses carried `Public can view active gyms` — USING
-- (is_active = true) TO anon — so every column of every gym was readable
-- by anyone holding the anon key, and the anon key ships inside the
-- client bundle. Verified as the anon role:
--
--   Camp Quannapowitt       Wakefield, MA  WKF2QPWT  42.512725,-71.076375
--   Sanford Springvale YMCA                APVUEH6Y  43.456896,-70.782541
--
-- That is every gym's JOIN CODE, plus street_address, postal_code, phone
-- and exact coordinates, downloadable without an account.
--
-- The code is the thing that matters. Mig 301 deliberately narrowed
-- gym_members reads to your own rows or a gym you belong to, and a code
-- is how you come to belong — so a world-readable code list walks around
-- the boundary 301 put up. Reading one code off the wall of the gym you
-- are standing in is the intended use; downloading all of them is not the
-- same act, and enumeration is the difference.
--
-- What a signed-out visitor legitimately needs is one card: this gym is
-- on Flexyn, here is its name, city and photo, here is how many people
-- train here. That is what the marketing site at flexyn.app/p/gym/:id
-- renders when someone scans a poster without the app, and it is all this
-- migration exposes.
--
-- Two anon-callable functions replace the blanket policy:
--
--   get_gym_public_card(uuid)   id → the card
--   get_gym_id_by_code(text)    a scanned code → which gym it is
--
-- Both are SECURITY DEFINER (the policy they replace is gone, so they
-- need to see the row) and STABLE, both return only for is_active gyms,
-- and NEITHER returns flexyn_code, coordinates, street address, postal
-- code, phone, owner_id, created_by_user_id or the osm_* provenance
-- columns. Authenticated users are unaffected — `gym_businesses: read
-- all` still covers the app.
--
-- Not fixed here, and worth a look next: get_gym_vs_gym_leaderboard is
-- EXECUTE-able by anon. Closing the table while leaving an anon-callable
-- function that reads it is the kind of half-boundary this file keeps
-- warning about.
--
-- ── RUN THIS IN TWO PARTS, IN THIS ORDER ────────────────────────────
--
-- The frontend ships via Netlify and the SQL is pasted by hand, so the
-- two land minutes apart in one direction or the other. Either ordering
-- of a single-shot migration breaks /p/gym/:id for signed-out visitors
-- during that gap: drop the policy first and the old bundle's table read
-- returns nothing, deploy first and the new bundle calls functions that
-- do not exist yet.
--
--   PART 1 (functions) — safe to run at ANY time. Purely additive; the
--     old bundle keeps using the policy and never calls them.
--   PART 2 (drop policy) — run once the Netlify deploy carrying
--     get_gym_public_card / getGymByCode is live.
--
-- Verified as the anon role in a rolled-back transaction: table reads go
-- 2 rows → 0, the card and the code lookup both answer, the card exposes
-- no flexyn_code / latitude / street_address / phone, and authenticated
-- reads are untouched.

-- ══ PART 1 · the functions (additive — run any time) ════════════════

-- ── The card ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_gym_public_card(p_gym_id UUID)
RETURNS TABLE (
  id            UUID,
  name          TEXT,
  description   TEXT,
  logo_url      TEXT,
  cover_url     TEXT,
  city          TEXT,
  state_code    TEXT,
  member_count  INTEGER,
  amenities     TEXT[],
  photo_urls    TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  SELECT id, name, description, logo_url, cover_url,
         city, state_code, member_count, amenities, photo_urls
    FROM public.gym_businesses
   WHERE id = p_gym_id
     AND is_active = TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.get_gym_public_card(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_public_card(UUID) TO anon, authenticated;

-- ── Which gym is this poster for? ───────────────────────────────────
-- The signed-out half of a signage scan. Returns identity only — enough
-- to route to the card above, nothing that could be joined against.
CREATE OR REPLACE FUNCTION public.get_gym_id_by_code(p_code TEXT)
RETURNS TABLE (
  id    UUID,
  name  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path TO 'public', 'pg_catalog'
AS $$
#variable_conflict use_column
BEGIN
  IF p_code IS NULL OR length(btrim(p_code)) <> 8 THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT id, name
    FROM public.gym_businesses
   WHERE flexyn_code = upper(btrim(p_code))
     AND is_active = TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.get_gym_id_by_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_id_by_code(TEXT) TO anon, authenticated;

-- ══ PART 2 · close the table (run AFTER the deploy is live) ═════════
-- Everything anon needs now goes through the two functions above.
DROP POLICY IF EXISTS "Public can view active gyms" ON public.gym_businesses;
