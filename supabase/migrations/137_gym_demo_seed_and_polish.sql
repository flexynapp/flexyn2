-- 137_gym_demo_seed_and_polish.sql
--
-- "Make sure the map shows something" — seeds 25 demonstration gyms
-- across the major US metros so the national map renders alive from
-- the moment the migrations land, instead of staring at a blank
-- continent waiting for real owners to sign up.
--
-- Also flips `gym_businesses.owner_id` to NULLABLE so these demo
-- rows can exist without an auth.users row backing them. Real gyms
-- (created via approve_gym_verification) ALWAYS get a real owner
-- from the verification queue — that path is unchanged.
--
-- Idempotent: every INSERT uses ON CONFLICT (flexyn_code) DO NOTHING
-- so re-running this migration (or pasting the deploy bundle twice)
-- is a no-op. The codes are hardcoded for determinism — re-runs hit
-- the same codes every time.
--
-- To CLEAN UP demos later (e.g. once enough real gyms exist), run:
--   DELETE FROM gym_businesses WHERE owner_id IS NULL AND name LIKE 'Demo:%';

-- ── Schema patch: allow owner-less demo gyms ─────────────────────────
ALTER TABLE public.gym_businesses
  ALTER COLUMN owner_id DROP NOT NULL;

-- ── Seed: 25 gyms across major US metros ────────────────────────────
-- Each name carries the "Demo:" prefix so they're easy to identify
-- visually + easy to bulk-delete. Member counts seeded to a small
-- positive number so they don't all sort last on the leaderboard.

INSERT INTO public.gym_businesses (
  name, city, state_code, country_code, latitude, longitude,
  flexyn_code, description, member_count
) VALUES
  ('Demo: Iron House Tribeca',      'New York',      'NY', 'US', 40.7195, -74.0089, 'NYC2DEMO',  'Demo gym in Tribeca.',          47),
  ('Demo: Brooklyn Strength Society','Brooklyn',     'NY', 'US', 40.6892, -73.9442, 'BKN3DEMO',  'Demo gym in Williamsburg.',     34),
  ('Demo: Venice Beach Fitness',    'Los Angeles',   'CA', 'US', 33.9850, -118.4695,'LAX4DEMO',  'Demo gym near the boardwalk.',  82),
  ('Demo: Hollywood Iron Club',     'Los Angeles',   'CA', 'US', 34.0928, -118.3287,'HLY5DEMO',  'Demo gym in Hollywood.',        51),
  ('Demo: SoMa Strength',           'San Francisco', 'CA', 'US', 37.7785, -122.4056,'SF67DEMO',  'Demo gym in SoMa.',             29),
  ('Demo: Mission Crossfit',        'San Francisco', 'CA', 'US', 37.7599, -122.4148,'SF8MDEMO',  'Demo gym in the Mission.',      62),
  ('Demo: Wicker Park Athletics',   'Chicago',       'IL', 'US', 41.9090, -87.6769, 'CHI9DEMO',  'Demo gym in Wicker Park.',      41),
  ('Demo: Loop Lifters Club',       'Chicago',       'IL', 'US', 41.8825, -87.6233, 'LPL2DEMO',  'Demo gym in The Loop.',         38),
  ('Demo: Cambridge Strength Lab',  'Cambridge',     'MA', 'US', 42.3736, -71.1097, 'CMB3DEMO',  'Demo gym near Harvard.',        24),
  ('Demo: Back Bay Barbell',        'Boston',        'MA', 'US', 42.3505, -71.0743, 'BBB4DEMO',  'Demo gym in Back Bay.',         55),
  ('Demo: Wynwood Fitness',         'Miami',         'FL', 'US', 25.8010, -80.1990, 'WYN5DEMO',  'Demo gym in Wynwood.',          73),
  ('Demo: South Beach Strength',    'Miami Beach',   'FL', 'US', 25.7826, -80.1340, 'SOB6DEMO',  'Demo gym on South Beach.',      89),
  ('Demo: Capitol Hill Iron',       'Seattle',       'WA', 'US', 47.6253, -122.3222,'CAP7DEMO',  'Demo gym on Cap Hill.',         33),
  ('Demo: Pioneer Square Athletics','Seattle',       'WA', 'US', 47.6010, -122.3346,'PIO8DEMO',  'Demo gym downtown.',            27),
  ('Demo: South Congress Strength', 'Austin',        'TX', 'US', 30.2502, -97.7491, 'ATX9DEMO',  'Demo gym on SoCo.',             45),
  ('Demo: East Austin Athletics',   'Austin',        'TX', 'US', 30.2622, -97.7137, 'EAA2DEMO',  'Demo gym in East Austin.',      52),
  ('Demo: Highlands Iron Co.',      'Denver',        'CO', 'US', 39.7670, -105.0173,'DEN3DEMO',  'Demo gym in the Highlands.',    36),
  ('Demo: RiNo Strength',           'Denver',        'CO', 'US', 39.7669, -104.9839,'RIN4DEMO',  'Demo gym in RiNo.',             44),
  ('Demo: Old Fourth Ward Athletics','Atlanta',      'GA', 'US', 33.7666, -84.3658, 'ATL5DEMO',  'Demo gym in O4W.',              31),
  ('Demo: Westside Iron Club',      'Atlanta',       'GA', 'US', 33.7790, -84.4106, 'WST6DEMO',  'Demo gym on the Westside.',     58),
  ('Demo: Pearl District Athletics','Portland',      'OR', 'US', 45.5273, -122.6817,'PDX7DEMO',  'Demo gym in the Pearl.',        42),
  ('Demo: Deep Ellum Iron Club',    'Dallas',        'TX', 'US', 32.7846, -96.7842, 'DAL8DEMO',  'Demo gym in Deep Ellum.',       66),
  ('Demo: Heights Strength Society','Houston',       'TX', 'US', 29.7989, -95.4030, 'HOU9DEMO',  'Demo gym in The Heights.',      49),
  ('Demo: Fishtown Athletics',      'Philadelphia',  'PA', 'US', 39.9719, -75.1308, 'PHL2DEMO',  'Demo gym in Fishtown.',         37),
  ('Demo: East Nashville Iron Co.', 'Nashville',     'TN', 'US', 36.1779, -86.7385, 'BNA3DEMO',  'Demo gym in East Nashville.',   54)
ON CONFLICT (flexyn_code) DO NOTHING;

NOTIFY pgrst, 'reload schema';
