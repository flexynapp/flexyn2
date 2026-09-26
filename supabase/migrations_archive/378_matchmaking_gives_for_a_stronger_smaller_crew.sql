-- 378_matchmaking_gives_for_a_stronger_smaller_crew.sql
--
-- Kegan, 2026-08-16: "make mismatch in members possible if one of the
-- members is just incredibly strong, there should be some give for faster
-- matchmaking."
--
-- THE ARGUMENT FOR LOOSENING AT ALL, which is not "matchmaking is slow":
-- `recompute_crew_war` already scores each side's TOP N where N is the
-- SMALLER roster (migration 356). A five-person crew fighting a four does
-- not get to field five. So roster size is already neutralised at scoring
-- time, and the matchmaker was charging 2.0 of a 9.5 denominator to guard
-- against an unfairness the scoring rule had removed.
--
-- THE BUG THIS FIXES, and it is the reason his case never matched: THE TWO
-- TERMS FOUGHT EACH OTHER. A small-but-strong crew was charged for the
-- roster gap AND charged again for the strength difference that was
-- compensating for it. The harder a small crew tried to make up the
-- difference, the further matchmaking pushed it away. Measured on the
-- installed function: 2v5 with the small crew much stronger scored 0.2532,
-- against a 0.15 first-pass tolerance — no match for 12 hours.
--
-- THREE CHANGES:
--
--   1. Roster weight 2.0 -> 1.2. Scoring already equalises rosters.
--   2. The roster term is DISCOUNTED, up to 75%, by how much stronger the
--      SMALLER crew is per head.
--   3. The strength term is ASYMMETRIC. A strength gap is a mismatch when
--      the smaller crew is the WEAKER one, and it is compensation when the
--      smaller crew is the stronger one, so in that direction it drops
--      from 2.0 to 0.5 rather than being charged twice.
--
-- BOTH OF THOSE ARE GATED ON THE ROSTERS ACTUALLY DIFFERING, and that gate
-- is load-bearing. Without it `p_roster_a <= p_roster_b` treats an EQUAL
-- pairing as "a is the smaller crew", so two four-person crews with wildly
-- different strength got the compensation discount and matched far too
-- easily: 4v4 with one side at 2.20 and the other at 1.00 fell from 0.1283
-- to 0.0354. With the gate it reads 0.1417 — slightly STRICTER than
-- before, which is correct, because with equal rosters there is no size
-- gap for strength to be compensating for.
--
-- The denominator carries the same asymmetric weight as the numerator, so
-- the result stays normalised to [0,1] and the tolerance in
-- `join_crew_war_queue` (0.15, opening 0.15 per 12h) keeps its meaning.
--
-- Signature is unchanged: `join_crew_war_queue` and `pair_waiting_crew_wars`
-- both call this positionally.
--
-- Paste-safe per repo convention.

CREATE OR REPLACE FUNCTION public.crew_match_gap(
  p_roster_a integer, p_age_a numeric, p_str_a numeric, p_cad_a numeric, p_div_a integer,
  p_roster_b integer, p_age_b numeric, p_str_b numeric, p_cad_b numeric, p_div_b integer
)
RETURNS numeric
LANGUAGE sql
IMMUTABLE
AS $function$
  WITH t AS (
    SELECT
      (p_roster_a IS NOT NULL AND p_roster_b IS NOT NULL
        AND NOT (COALESCE(p_roster_a,0) = COALESCE(p_roster_b,0)))          AS sizes_differ,
      CASE WHEN COALESCE(p_roster_a,0) = LEAST(COALESCE(p_roster_a,0), COALESCE(p_roster_b,0))
           THEN p_str_a ELSE p_str_b END                                     AS str_small,
      CASE WHEN COALESCE(p_roster_a,0) = LEAST(COALESCE(p_roster_a,0), COALESCE(p_roster_b,0))
           THEN p_str_b ELSE p_str_a END                                     AS str_big
  ), adv AS (
    SELECT CASE
      WHEN sizes_differ AND str_small IS NOT NULL AND str_big IS NOT NULL
      THEN GREATEST(0.0, LEAST(1.0, (str_small - str_big) / GREATEST(str_big, 0.01)))
      ELSE 0.0 END AS advantage
    FROM t
  ), w AS (
    SELECT advantage,
           CASE WHEN advantage > 0 THEN 0.5 ELSE 2.0 END AS str_weight
    FROM adv
  )
  SELECT (
      3.0 * LEAST(1.0, ABS(COALESCE(p_div_a, 1) - COALESCE(p_div_b, 1)) / 3.0)
    + 1.2 * (ABS(COALESCE(p_roster_a, 0) - COALESCE(p_roster_b, 0))::numeric
             / GREATEST(COALESCE(p_roster_a, 0), COALESCE(p_roster_b, 0), 1))
          * (1.0 - 0.75 * w.advantage)
    + 1.5 * LEAST(1.0, ABS(COALESCE(p_cad_a, 0) - COALESCE(p_cad_b, 0)) / 4.0)
    + CASE WHEN p_str_a IS NOT NULL AND p_str_b IS NOT NULL
           THEN w.str_weight * (ABS(p_str_a - p_str_b) / GREATEST(p_str_a, p_str_b, 1))
           ELSE 0.0 END
    + CASE WHEN p_age_a IS NOT NULL AND p_age_b IS NOT NULL
           THEN 1.0 * LEAST(1.0, ABS(p_age_a - p_age_b) / 20.0)
           ELSE 0.0 END
  ) / (
      5.7
    + CASE WHEN p_str_a IS NOT NULL AND p_str_b IS NOT NULL THEN w.str_weight ELSE 0.0 END
    + CASE WHEN p_age_a IS NOT NULL AND p_age_b IS NOT NULL THEN 1.0 ELSE 0.0 END
  )
  FROM w;
$function$;

SELECT
  round(public.crew_match_gap(4,30,1.20,3,1, 4,30,1.20,3,1), 4) AS identical_4v4,
  round(public.crew_match_gap(4,30,2.20,3,1, 4,30,1.00,3,1), 4) AS equal_size_strength_gap,
  round(public.crew_match_gap(2,30,2.10,3,1, 5,30,1.10,3,1), 4) AS small_much_stronger,
  round(public.crew_match_gap(2,30,0.90,3,1, 5,30,1.30,3,1), 4) AS small_weaker,
  round(public.crew_match_gap(5,30,1.20,3,1, 4,30,1.20,3,1), 4) AS five_v_four_same;
