-- App audit 2026-09-30, server fixes. Each block says what a user hit.

-- 1. Marketplace: no direct listing INSERT from the client ---------------
--
-- "marketplace: sellers can create listings" checked only
-- seller_user_id = auth.uid(). inventory_id, item_name, item_rarity,
-- seller_username and is_featured were all whatever the client sent. Two
-- consequences:
--   * a seller could list a "legendary" and deliver their real common
--     (purchase_listing moves the real inventory row);
--   * purchase_bundle moved every bundled listing's inventory_id to the
--     buyer with no owner check, so a listing pointing at SOMEONE ELSE's
--     item, placed in your own bundle and bought from an alt, moved the
--     victim's item to the alt.
-- The app never inserts directly: create_marketplace_listing (SECURITY
-- DEFINER, copies the item from the caller's own inventory) is the only
-- writer. So the policy and the grant go, and purchase_bundle also checks
-- that each item still belongs to the bundle's seller.

DROP POLICY IF EXISTS "marketplace: sellers can create listings" ON public.marketplace_listings;
REVOKE INSERT ON public.marketplace_listings FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.purchase_bundle(p_bundle_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_buyer_id      UUID := auth.uid();
  v_buyer_email   TEXT;
  v_bundle_status TEXT;
  v_bundle_seller UUID;
  v_discount_pct  NUMERIC;
  v_lid           UUID;
  v_price         INTEGER;
  v_inv           UUID;
  v_total_price   INTEGER := 0;
  v_discounted    INTEGER;
  v_buyer_coins   INTEGER;
  v_listing_ids   UUID[] := '{}';
BEGIN
  IF v_buyer_id IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  v_buyer_email := NULLIF(public.current_user_email(), '');

  SELECT status, seller_user_id, discount_pct
    INTO v_bundle_status, v_bundle_seller, v_discount_pct
    FROM public.marketplace_bundles
   WHERE id = p_bundle_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bundle_not_found';
  END IF;
  IF v_bundle_status <> 'active' THEN
    RAISE EXCEPTION 'bundle_not_available';
  END IF;
  IF v_bundle_seller = v_buyer_id THEN
    RAISE EXCEPTION 'cannot_buy_own_bundle';
  END IF;

  -- Only the bundle owner's own listings, and only while the item behind
  -- each one is still theirs and not held in a trade escrow.
  FOR v_lid, v_price IN
    SELECT l.id, l.asking_price
      FROM public.marketplace_listings l
      JOIN public.user_inventory i ON i.id = l.inventory_id
     WHERE l.bundle_id = p_bundle_id
       AND l.seller_user_id = v_bundle_seller
       AND l.status = 'active'
       AND l.listing_type = 'sale'
       AND i.user_id = v_bundle_seller
       AND i.escrow_offer_id IS NULL
       FOR UPDATE OF l, i
  LOOP
    v_total_price := v_total_price + COALESCE(v_price, 0);
    v_listing_ids := array_append(v_listing_ids, v_lid);
  END LOOP;

  IF array_length(v_listing_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'bundle_empty';
  END IF;

  v_discounted := GREATEST(1, ROUND(v_total_price * (1 - v_discount_pct / 100)));

  SELECT COALESCE(flex_coins, 0) INTO v_buyer_coins
    FROM public.user_profiles
   WHERE id = v_buyer_id
     FOR UPDATE;
  IF v_buyer_coins IS NULL THEN
    RAISE EXCEPTION 'buyer profile not found' USING ERRCODE = '22023';
  END IF;
  IF v_buyer_coins < v_discounted THEN
    RAISE EXCEPTION 'insufficient_coins';
  END IF;

  UPDATE public.user_profiles
     SET flex_coins = flex_coins - v_discounted
   WHERE id = v_buyer_id;

  UPDATE public.user_profiles
     SET flex_coins = COALESCE(flex_coins, 0) + v_discounted
   WHERE id = v_bundle_seller;

  FOR v_lid, v_inv IN
    SELECT id, inventory_id
      FROM public.marketplace_listings
     WHERE id = ANY(v_listing_ids)
  LOOP
    UPDATE public.user_inventory
       SET user_id    = v_buyer_id,
           user_email = v_buyer_email,
           is_listed  = false
     WHERE id = v_inv
       AND user_id = v_bundle_seller;

    UPDATE public.marketplace_listings
       SET status = 'completed'
     WHERE id = v_lid;
  END LOOP;

  UPDATE public.marketplace_bundles
     SET status = 'completed'
   WHERE id = p_bundle_id;

  RETURN jsonb_build_object(
    'bundle_id',     p_bundle_id,
    'listing_count', array_length(v_listing_ids, 1),
    'total_price',   v_total_price,
    'paid_price',    v_discounted,
    'buyer_coins',   v_buyer_coins - v_discounted
  );
END;
$function$;

-- 2. Daily drop purchases land in the bag --------------------------------
--
-- purchase_branded_item took the coins and wrote user_branded_items, a
-- table nothing reads. The bag reads user_inventory, so every Daily Drop
-- purchase showed "added to your bag" and delivered nothing. The item
-- details below mirror BRANDED_ITEMS in src/lib/lootCatalog.js, the same
-- list whose prices this function already carried.

CREATE OR REPLACE FUNCTION public._branded_item(p_sku text)
 RETURNS TABLE(price integer, item_name text, item_emoji text, item_rarity text, item_type text)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT v.price, v.item_name, v.item_emoji, v.item_rarity, v.item_type
    FROM (VALUES
    ('flx_dumbbell', 25, 'Iron Dumbbell', '🏋️', 'common', 'sticker'),
    ('flx_band', 25, 'Wristband', '⚪', 'common', 'sticker'),
    ('flx_chalk', 25, 'Chalk Bag', '⬜', 'common', 'sticker'),
    ('flx_shoes', 25, 'Lifters', '👟', 'common', 'sticker'),
    ('flx_water', 25, 'Hydrate', '💧', 'common', 'sticker'),
    ('flx_apple', 25, 'Clean Eats', '🍎', 'common', 'sticker'),
    ('flx_egg', 25, 'Protein', '🥚', 'common', 'sticker'),
    ('flx_alarm', 25, 'Early Bird', '⏰', 'common', 'sticker'),
    ('flx_pencil', 25, 'Log It', '📝', 'common', 'sticker'),
    ('flx_sweat', 25, 'Sweat Drip', '💦', 'common', 'sticker'),
    ('flx_logo', 50, 'Flexyn Logo', '🟧', 'uncommon', 'sticker'),
    ('flx_day_one', 50, 'Day One', '①', 'uncommon', 'sticker'),
    ('flx_keychain', 50, 'Flexyn Keychain', '🔑', 'uncommon', 'sticker'),
    ('flx_bottle', 50, 'Hydro Bottle', '🧊', 'uncommon', 'sticker'),
    ('flx_muscle', 50, 'Flex', '💪', 'uncommon', 'sticker'),
    ('flx_lightbolt', 50, 'Volt', '⚡', 'uncommon', 'sticker'),
    ('flx_target', 50, 'On Target', '🎯', 'uncommon', 'sticker'),
    ('flx_med1', 50, 'First Place', '🥇', 'uncommon', 'sticker'),
    ('flx_med2', 50, 'Second Place', '🥈', 'uncommon', 'sticker'),
    ('flx_med3', 50, 'Third Place', '🥉', 'uncommon', 'sticker'),
    ('flx_og', 120, 'OG', '🏷️', 'rare', 'title'),
    ('flx_anvil', 80, 'Flex Anvil', '⚒️', 'rare', 'sticker'),
    ('flx_belt', 100, 'Lifting Belt', '🥋', 'rare', 'sticker'),
    ('flx_swords', 100, 'Battle Mode', '⚔️', 'rare', 'sticker'),
    ('flx_shield', 100, 'Crew Shield', '🛡️', 'rare', 'sticker'),
    ('flx_rocket', 100, 'Take Off', '🚀', 'rare', 'sticker'),
    ('flx_diamond', 100, 'Diamond Grip', '💎', 'rare', 'sticker'),
    ('flx_runner', 100, 'Sprinter', '🏃', 'rare', 'sticker'),
    ('flx_streak', 200, 'Streak Flame', '🔥', 'epic', 'sticker'),
    ('flx_dragon', 200, 'Beast Mode', '🐉', 'epic', 'sticker'),
    ('flx_eagle', 200, 'Apex Predator', '🦅', 'epic', 'sticker'),
    ('flx_galaxy', 200, 'Cosmic Pump', '🌌', 'epic', 'sticker'),
    ('flx_lion', 200, 'Pride', '🦁', 'epic', 'sticker'),
    ('flx_crown', 400, 'Champion Frame', '👑', 'legendary', 'frame'),
    ('flx_trophy', 400, 'Hall of Fame', '🏆', 'legendary', 'sticker'),
    ('flx_radiance', 400, 'Radiance', '🌟', 'legendary', 'sticker'),
    ('flx_comet', 400, 'Streak Comet', '☄️', 'legendary', 'sticker'),
    ('flx_sparkles', 1000, 'Sparkles', '✨', 'animated', 'sticker')
    ) AS v(sku, price, item_name, item_emoji, item_rarity, item_type)
   WHERE v.sku = p_sku;
$function$;

REVOKE ALL ON FUNCTION public._branded_item(text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.purchase_branded_item(p_sku text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid          UUID := auth.uid();
  v_email        TEXT;
  v_item         RECORD;
  v_balance      INTEGER;
  v_new_balance  INTEGER;
  v_inventory_id UUID;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_item FROM public._branded_item(p_sku);
  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown_sku: %', p_sku USING ERRCODE = '22023';
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_branded_items WHERE user_id = v_uid AND sku = p_sku) THEN
    RAISE EXCEPTION 'already_owned' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(flex_coins, 0), NULLIF(email, '')
    INTO v_balance, v_email
    FROM public.user_profiles
   WHERE id = v_uid FOR UPDATE;
  IF v_balance IS NULL THEN
    RAISE EXCEPTION 'buyer_profile_not_found' USING ERRCODE = '22023';
  END IF;
  IF v_balance < v_item.price THEN
    RAISE EXCEPTION 'insufficient_coins: have %, need %', v_balance, v_item.price
      USING ERRCODE = '22023';
  END IF;
  v_email := COALESCE(v_email, 'guest_' || v_uid || '@flexyn.guest');

  v_new_balance := v_balance - v_item.price;
  UPDATE public.user_profiles SET flex_coins = v_new_balance WHERE id = v_uid;

  INSERT INTO public.user_branded_items (user_id, user_email, sku)
  VALUES (v_uid, v_email, p_sku);

  INSERT INTO public.user_inventory
    (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, acquired_via)
  VALUES
    (v_uid, v_email, p_sku, v_item.item_name, v_item.item_emoji, v_item.item_rarity, v_item.item_type, 'daily_drop')
  RETURNING id INTO v_inventory_id;

  RETURN jsonb_build_object(
    'success',      true,
    'sku',          p_sku,
    'price',        v_item.price,
    'new_balance',  v_new_balance,
    'inventory_id', v_inventory_id
  );
END;
$function$;

-- Deliver what was already paid for: every branded purchase with no
-- matching bag item. Additive only.
INSERT INTO public.user_inventory
  (user_id, user_email, item_id, item_name, item_emoji, item_rarity, item_type, acquired_via, acquired_at)
SELECT b.user_id,
       COALESCE(NULLIF(p.email, ''), 'guest_' || b.user_id || '@flexyn.guest'),
       b.sku, bi.item_name, bi.item_emoji, bi.item_rarity, bi.item_type, 'daily_drop', b.acquired_at
  FROM public.user_branded_items b
  JOIN public.user_profiles p ON p.id = b.user_id
  CROSS JOIN LATERAL public._branded_item(b.sku) bi
 WHERE NOT EXISTS (
   SELECT 1 FROM public.user_inventory i
    WHERE i.user_id = b.user_id AND i.item_id = b.sku
 );

-- 3. Friend-post notifications respect who the post is for ---------------
--
-- HubComposer fans out notify_friend_post_for to followers after every
-- post, and the function only checked the follow. A crew-only post sent
-- its first 100 characters to followers outside the crew, as a push, and
-- a scheduled post notified everyone before it was published. The follow
-- check now uses ids (hub_follows has both on all rows) so guests, whose
-- auth email is NULL, are notified too.

CREATE OR REPLACE FUNCTION public.notify_friend_post_for(p_user_id uuid, p_post_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_sender UUID := auth.uid(); v_name TEXT; v_sender_email TEXT;
  v_author UUID; v_body TEXT; v_privacy TEXT; v_publish_at TIMESTAMPTZ;
  v_lang TEXT; v_text JSONB; v_id UUID;
BEGIN
  IF v_sender IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE='42501'; END IF;
  IF p_user_id IS NULL OR p_post_id IS NULL THEN
    RAISE EXCEPTION 'user_id and post_id required' USING ERRCODE='22023'; END IF;
  IF p_user_id = v_sender THEN RETURN NULL; END IF;

  SELECT user_id, body, COALESCE(privacy, 'public'), publish_at
    INTO v_author, v_body, v_privacy, v_publish_at
    FROM public.hub_posts WHERE id = p_post_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'post not found' USING ERRCODE='22023'; END IF;
  IF v_author IS DISTINCT FROM v_sender THEN RAISE EXCEPTION 'not your post' USING ERRCODE='42501'; END IF;

  -- Only posts every follower may read, and only once they are live.
  IF v_privacy NOT IN ('public', 'followers') THEN RETURN NULL; END IF;
  IF v_publish_at IS NOT NULL AND v_publish_at > now() THEN RETURN NULL; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.hub_follows
                  WHERE follower_id = p_user_id AND followee_id = v_sender) THEN
    RAISE EXCEPTION 'recipient does not follow you' USING ERRCODE='42501';
  END IF;

  SELECT username, email INTO v_name, v_sender_email FROM public.user_profiles WHERE id = v_sender;
  IF v_name IS NULL OR v_name = '' THEN
    v_name := COALESCE(NULLIF(SPLIT_PART(COALESCE(v_sender_email, ''), '@', 1), ''), 'Someone');
  ELSE v_name := '@' || v_name; END IF;

  SELECT preferred_language INTO v_lang FROM public.user_profiles WHERE id = p_user_id;
  v_text := public.friend_post_text(COALESCE(v_lang,'en'), v_name);
  -- user_email is filled from user_profiles by the notifications trigger.
  INSERT INTO public.notifications (user_id,type,title,body,icon,link_url,metadata)
  VALUES (p_user_id,'friend_post',v_text->>'title',
          COALESCE(SUBSTRING(COALESCE(v_body,'') FROM 1 FOR 100),''),'✨','/hub',
          jsonb_build_object('posterName',v_name,'postId',p_post_id)) RETURNING id INTO v_id;
  RETURN v_id;
END; $function$;

-- 4. Guests can join and register gyms -----------------------------------
--
-- join_gym_by_code and submit_gym_verification read the email from
-- auth.users, which is NULL for every guest account, into NOT NULL
-- columns. Joining by code (typed, QR, or "Join this gym") and
-- registering a gym both failed with 23502 for guests. They now take the
-- profile email, which every account has.

CREATE OR REPLACE FUNCTION public.join_gym_by_code(p_code text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_email     TEXT;
  v_gym_id    UUID;
  v_member_id UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_code IS NULL OR length(p_code) <> 8 THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'INVALID_CODE');
  END IF;
  SELECT id INTO v_gym_id FROM public.gym_businesses
   WHERE flexyn_code = upper(trim(p_code)) AND is_active = TRUE;
  IF v_gym_id IS NULL THEN RETURN jsonb_build_object('ok', FALSE, 'error', 'CODE_NOT_FOUND'); END IF;
  SELECT COALESCE(NULLIF(email, ''), 'guest_' || v_uid || '@flexyn.guest')
    INTO v_email FROM public.user_profiles WHERE id = v_uid;
  v_email := COALESCE(v_email, 'guest_' || v_uid || '@flexyn.guest');
  INSERT INTO public.gym_members (gym_id, user_id, user_email)
  VALUES (v_gym_id, v_uid, v_email) ON CONFLICT (gym_id, user_id) DO NOTHING
  RETURNING id INTO v_member_id;
  RETURN jsonb_build_object('ok', TRUE, 'gymId', v_gym_id,
                            'memberId', v_member_id,
                            'alreadyMember', v_member_id IS NULL);
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_gym_verification(p_business_name text, p_street_address text, p_city text, p_state_code text, p_postal_code text, p_country_code text DEFAULT 'US'::text, p_phone text DEFAULT NULL::text, p_website_url text DEFAULT NULL::text, p_proof_url text DEFAULT NULL::text, p_latitude double precision DEFAULT NULL::double precision, p_longitude double precision DEFAULT NULL::double precision)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid   UUID := auth.uid();
  v_email TEXT;
  v_id    UUID;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501'; END IF;
  IF p_business_name IS NULL OR length(trim(p_business_name)) < 2 THEN
    RAISE EXCEPTION 'business_name required' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(NULLIF(email, ''), 'guest_' || v_uid || '@flexyn.guest')
    INTO v_email FROM public.user_profiles WHERE id = v_uid;
  v_email := COALESCE(v_email, 'guest_' || v_uid || '@flexyn.guest');
  INSERT INTO public.gym_verification_queue (
    owner_id, owner_email, business_name, street_address, city, state_code,
    postal_code, country_code, phone, website_url, proof_url, latitude, longitude
  ) VALUES (
    v_uid, v_email, p_business_name, p_street_address, p_city, p_state_code,
    p_postal_code, p_country_code, p_phone, p_website_url, p_proof_url, p_latitude, p_longitude
  ) RETURNING id INTO v_id;
  UPDATE public.user_profiles SET account_type = 'gym_owner' WHERE id = v_uid AND account_type = 'user';
  RETURN v_id;
END;
$function$;
