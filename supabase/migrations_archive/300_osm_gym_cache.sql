-- 300_osm_gym_cache.sql
--
-- Cache OpenStreetMap gyms in our own Postgres so the picker stops
-- asking a donated public service from a phone on cellular.
--
-- ── The numbers this exists for ──────────────────────────────────────
--
-- Measured from Sanford, Maine, three runs each, 2026-08-06:
--
--   Overpass,  5 mi radius      4.3s   3.5s   2.3s      3 KB
--   Overpass, 30 mi radius     30.0s✗  5.9s   4.6s     78 KB
--   get_gyms_in_bbox                   19 ms
--
-- Same question, three orders of magnitude apart — and the wide query
-- fails outright about one run in three, because Overpass mirrors are
-- donated infrastructure that 429s and 504s under load. A user reported
-- fifteen seconds and no gyms; that is what fifteen seconds is made of.
--
-- ── Shape ────────────────────────────────────────────────────────────
--
-- osm_gym_cache   the gyms, keyed (osm_type, osm_id) — the same key
--                 migration 275 uses, because OSM ids are unique only
--                 WITHIN a type and node/123 is not way/123.
-- osm_gym_tiles   which 0.1-degree squares have been fetched, and when.
--                 Coverage bookkeeping, so we can tell "no gyms here"
--                 from "never looked here" — the same distinction the
--                 picker already has to make in the UI, and for the same
--                 reason: one is a fact about the world, the other is a
--                 fact about us.
--
-- 0.1 degrees is ~11 km north-south and ~8 km east-west at Maine's
-- latitude. The tile grid is bookkeeping only: a fill fetches the query
-- box ROUNDED OUT to tile edges in ONE Overpass call, then marks every
-- covered tile. Rounding costs proportionally less as the query grows —
-- a 5-mile box doubles, a 30-mile box grows by about a seventh.
--
-- ── Why cache rather than change providers ───────────────────────────
--
-- Considered and rejected: Photon is a geocoder, so "every gym in a
-- radius" is not a query it answers well. Google Places forbids caching
-- or storing its POI data, which is exactly what promoting a gym into
-- gym_businesses does. Foursquare means a commercial key for coverage
-- no better than OSM's in rural Maine. Self-hosting Overpass is a
-- planet import and a server to babysit. Overture is good open data but
-- ships as a bulk dump, so you end up building this table anyway.
--
-- Caching keeps the data source, the licence and the zero vendor count,
-- and fixes the reliability problem as a side effect: a served cache
-- doesn't care that Overpass is down.
--
-- ── Freshness ────────────────────────────────────────────────────────
--
-- Gyms open and close on a scale of months, so a tile is good for 30
-- days. Past that the client still renders what is cached IMMEDIATELY
-- and refreshes behind the user — stale-while-revalidate. Showing a
-- month-old gym list instantly beats showing a spinner for five seconds
-- to confirm the same list.

CREATE TABLE IF NOT EXISTS public.osm_gym_cache (
  osm_type   TEXT   NOT NULL,
  osm_id     BIGINT NOT NULL,
  name       TEXT   NOT NULL,
  latitude   DOUBLE PRECISION NOT NULL,
  longitude  DOUBLE PRECISION NOT NULL,
  brand      TEXT,
  website    TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (osm_type, osm_id)
);

-- The only read pattern is a bounding box.
CREATE INDEX IF NOT EXISTS osm_gym_cache_geo_idx
  ON public.osm_gym_cache (latitude, longitude);

CREATE TABLE IF NOT EXISTS public.osm_gym_tiles (
  tile_y    INTEGER NOT NULL,
  tile_x    INTEGER NOT NULL,
  filled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  gym_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tile_y, tile_x)
);

ALTER TABLE public.osm_gym_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.osm_gym_tiles ENABLE ROW LEVEL SECURITY;

-- Read-only to clients. Writes are service_role (the edge function),
-- which bypasses RLS — there is deliberately no client INSERT policy,
-- for the same reason scheduled_workouts has none: a client that can
-- write the cache can poison what every other user sees nearby.
DROP POLICY IF EXISTS osm_gym_cache_read ON public.osm_gym_cache;
CREATE POLICY osm_gym_cache_read ON public.osm_gym_cache
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS osm_gym_tiles_read ON public.osm_gym_tiles;
CREATE POLICY osm_gym_tiles_read ON public.osm_gym_tiles
  FOR SELECT TO authenticated USING (TRUE);

GRANT SELECT ON public.osm_gym_cache TO authenticated;
GRANT SELECT ON public.osm_gym_tiles TO authenticated;

-- ── The read the picker actually makes ───────────────────────────────
--
-- Returns the gyms AND the coverage, because the caller has to be able
-- to tell an empty area from an unvisited one. tiles_fresh < tiles_total
-- is what tells the client to ask the edge function for a fill.
CREATE OR REPLACE FUNCTION public.get_osm_gyms_cached(
  p_min_lat      DOUBLE PRECISION,
  p_max_lat      DOUBLE PRECISION,
  p_min_lng      DOUBLE PRECISION,
  p_max_lng      DOUBLE PRECISION,
  p_limit        INTEGER DEFAULT 300,
  p_max_age_days INTEGER DEFAULT 30
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_gyms  JSONB;
  v_total INTEGER;
  v_known INTEGER;
  v_fresh INTEGER;
BEGIN
  IF p_min_lat IS NULL OR p_max_lat IS NULL
     OR p_min_lng IS NULL OR p_max_lng IS NULL THEN
    RETURN jsonb_build_object(
      'gyms', '[]'::jsonb, 'tiles_total', 0, 'tiles_known', 0, 'tiles_fresh', 0);
  END IF;

  WITH picked AS (
    SELECT osm_type, osm_id, name, latitude, longitude, brand, website
      FROM public.osm_gym_cache
     WHERE latitude  BETWEEN p_min_lat AND p_max_lat
       AND longitude BETWEEN p_min_lng AND p_max_lng
     LIMIT p_limit
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'osmType', osm_type,
           'osmId',   osm_id,
           'name',    name,
           'lat',     latitude,
           'lon',     longitude,
           'brand',   brand,
           'website', website
         )), '[]'::jsonb)
    INTO v_gyms
    FROM picked;

  -- Every 0.1-degree tile the box touches, and how many of them we have
  -- looked at recently enough to trust.
  WITH want AS (
    SELECT gy AS ty, gx AS tx
      FROM generate_series(floor(p_min_lat / 0.1)::INTEGER,
                           floor(p_max_lat / 0.1)::INTEGER) AS gy,
           generate_series(floor(p_min_lng / 0.1)::INTEGER,
                           floor(p_max_lng / 0.1)::INTEGER) AS gx
  )
  SELECT count(*) INTO v_total FROM want;

  -- KNOWN and FRESH are counted separately because they mean different
  -- things to the caller. A tile we have never looked at must be filled
  -- before we can say anything about the area. A tile we looked at last
  -- month can be served immediately and refreshed behind the user —
  -- showing a month-old gym list instantly beats a five-second spinner
  -- that confirms the same list.
  WITH want AS (
    SELECT gy AS ty, gx AS tx
      FROM generate_series(floor(p_min_lat / 0.1)::INTEGER,
                           floor(p_max_lat / 0.1)::INTEGER) AS gy,
           generate_series(floor(p_min_lng / 0.1)::INTEGER,
                           floor(p_max_lng / 0.1)::INTEGER) AS gx
  )
  SELECT
    count(*) FILTER (WHERE tile_y IS NOT NULL),
    count(*) FILTER (
      WHERE filled_at > now() - make_interval(days => p_max_age_days))
    INTO v_known, v_fresh
    FROM want
    LEFT JOIN public.osm_gym_tiles ON tile_y = ty AND tile_x = tx;

  RETURN jsonb_build_object(
    'gyms',        v_gyms,
    'tiles_total', COALESCE(v_total, 0),
    'tiles_known', COALESCE(v_known, 0),
    'tiles_fresh', COALESCE(v_fresh, 0));
END;
$$;

REVOKE ALL ON FUNCTION public.get_osm_gyms_cached(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  INTEGER, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_osm_gyms_cached(
  DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION,
  INTEGER, INTEGER) TO authenticated;
