-- Remove the guest account a release check created on production.
--
-- On 2026-10-02 a click-through of the release preview signed in as a
-- guest against production and created probeguest24425. Test accounts on
-- production join real league brackets and leaderboards, so Kegan asked
-- for it to be deleted ("delete probe", 2026-10-02).
--
-- Measured before writing this: the account owns 1 user_profiles row,
-- 3 user_daily_quests, 1 user_capsules, 1 notifications,
-- 1 coach_intro_quota, 1 flex_coin_grant_ledger and 1 flex_coin_ledger
-- row, and no storage objects. All of those except flex_coin_ledger
-- cascade from auth.users; flex_coin_ledger has no foreign key, so its
-- row is removed explicitly first.
--
-- Every statement is pinned to the account's id, and runs only while that
-- id is still the anonymous probe account, so this is a no-op anywhere
-- else (local databases, preview branches) and cannot touch a real user.

DO $remove$
DECLARE
  v_id CONSTANT uuid := '1a0d7ec1-eb63-4e8e-9a4d-5b5f07e88983';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM auth.users u
      JOIN public.user_profiles p ON p.id = u.id
     WHERE u.id = v_id AND u.is_anonymous AND p.username = 'probeguest24425'
  ) THEN
    RAISE NOTICE 'probe guest not present; nothing to remove';
    RETURN;
  END IF;

  DELETE FROM public.flex_coin_ledger WHERE user_id = v_id;
  DELETE FROM auth.users WHERE id = v_id AND is_anonymous;

  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_id)
     OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = v_id)
     OR EXISTS (SELECT 1 FROM public.flex_coin_ledger WHERE user_id = v_id)
     OR EXISTS (SELECT 1 FROM public.user_daily_quests WHERE user_id = v_id) THEN
    RAISE EXCEPTION 'probe guest was not fully removed';
  END IF;
END;
$remove$;
