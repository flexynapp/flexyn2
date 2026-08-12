-- 343_food_item_requests.sql
--
-- "Request this item" — the moderated half of the food database.
--
-- WHAT CHANGES, AND WHY IT IS NOT A DIRECT WRITE
--
-- Today a barcode Open Food Facts does not know opens BarcodeNotFoundModal,
-- which writes straight into `public.food_items`. That row is then shared
-- with every future scanner, unreviewed. It is exactly the shape that made
-- MyFitnessPal's catalogue what it is: anyone can add an entry, no source, no
-- review, and "chicken breast" ends up returning hundreds of near-duplicate
-- rows with different numbers.
--
-- So a miss now files a REQUEST instead. It lands in a moderation queue,
-- an admin approves it, and only then does a `food_items` row exist. The
-- wiring deliberately mirrors `bug_reports` (migration 144) end to end:
-- a plain insert from the client, an admin-gated SECURITY DEFINER reader,
-- and an admin-gated status transition.
--
-- ONE THING THIS DOES NOT DO, AND IT IS WORTH SAYING PLAINLY:
-- it does not email anybody. Neither does Report a Bug — `bug_reports` has
-- no trigger, no pg_net call, and nothing in the database references a
-- support address. Both queues are read in-app at /admin/reports. If these
-- should reach an inbox, that is a separate piece of work (an Edge Function
-- plus a mail provider) and it would light up bug reports at the same time.
--
-- Idempotent throughout.

-- ── 1. The queue ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.food_item_requests (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_email   TEXT,
  requester_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  barcode           TEXT,
  name              TEXT NOT NULL,
  brand             TEXT,
  serving_label     TEXT,
  -- Same two jsonb shapes food_items already uses, so approval is a copy
  -- rather than a translation.
  nutrition         JSONB,
  vitamins          JSONB,
  note              TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID,
  approved_item_id  UUID
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'food_item_requests_status_check'
  ) THEN
    ALTER TABLE public.food_item_requests
      ADD CONSTRAINT food_item_requests_status_check
      CHECK (status IN ('pending', 'approved', 'rejected'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS food_item_requests_status_idx
  ON public.food_item_requests (status, created_at DESC);

-- One pending request per barcode. Two people scanning the same unknown
-- product should join one queue entry, not create two rows that an admin
-- then has to reconcile by hand.
CREATE UNIQUE INDEX IF NOT EXISTS food_item_requests_pending_barcode_idx
  ON public.food_item_requests (barcode)
  WHERE status = 'pending' AND barcode IS NOT NULL;

ALTER TABLE public.food_item_requests ENABLE ROW LEVEL SECURITY;

-- File your own request.
DROP POLICY IF EXISTS food_item_requests_insert_own ON public.food_item_requests;
CREATE POLICY food_item_requests_insert_own ON public.food_item_requests
  FOR INSERT TO authenticated
  WITH CHECK (requester_user_id = auth.uid());

-- Read your own back, so the UI can say "you already asked for this".
-- Deliberately NOT readable across users: a pending request is unreviewed
-- text, and the whole point of the queue is that it is not published yet.
DROP POLICY IF EXISTS food_item_requests_select_own ON public.food_item_requests;
CREATE POLICY food_item_requests_select_own ON public.food_item_requests
  FOR SELECT TO authenticated
  USING (requester_user_id = auth.uid());

-- No client UPDATE or DELETE policy on purpose. Status is moved only by the
-- admin RPCs below — an UPDATE scoped to the requester would let anyone flip
-- their own row to 'approved', which is the whole gate.

-- ── 2. Admin reader ─────────────────────────────────────────────────
-- RETURNS SETOF the table rowtype rather than a TABLE(...) spec so the body
-- needs no alias.column tokens — see the paste-safety rule in CLAUDE.md.
CREATE OR REPLACE FUNCTION public.list_food_item_requests_for_admin(
  p_status TEXT DEFAULT 'pending',
  p_limit  INT  DEFAULT 50
)
RETURNS SETOF public.food_item_requests
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.food_item_requests
     WHERE status = p_status
     ORDER BY created_at DESC
     LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
END;
$$;

REVOKE ALL ON FUNCTION public.list_food_item_requests_for_admin(TEXT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_food_item_requests_for_admin(TEXT, INT) TO authenticated;

-- ── 3. Approve — the only thing that ever writes food_items from a request ──
-- Scalar SELECT ... INTO rather than %ROWTYPE plus dotted record access, so
-- the body carries no `rec.column` tokens (paste safety, CLAUDE.md rule 7).
CREATE OR REPLACE FUNCTION public.approve_food_item_request(p_request_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name      TEXT;
  v_brand     TEXT;
  v_barcode   TEXT;
  v_serving   TEXT;
  v_nutrition JSONB;
  v_vitamins  JSONB;
  v_email     TEXT;
  v_user      UUID;
  v_status    TEXT;
  v_new_id    UUID;
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  SELECT name, brand, barcode, serving_label, nutrition, vitamins,
         requester_email, requester_user_id, status
    INTO v_name, v_brand, v_barcode, v_serving, v_nutrition, v_vitamins,
         v_email, v_user, v_status
    FROM public.food_item_requests
   WHERE id = p_request_id;

  IF v_name IS NULL THEN
    RAISE EXCEPTION 'no such request' USING ERRCODE = '22023';
  END IF;
  IF v_status <> 'pending' THEN
    RAISE EXCEPTION 'already reviewed' USING ERRCODE = '22023';
  END IF;

  -- Attribution stays with the member who found it, not the admin who
  -- approved it: they did the work of reading the label.
  INSERT INTO public.food_items
    (created_by, user_id, name, brand, barcode, serving_label,
     calories, protein, carbs, fat, fiber, sodium,
     nutrition, vitamins, is_verified, source)
  VALUES
    (v_email, v_user, v_name, v_brand, v_barcode, COALESCE(v_serving, '1 serving'),
     (v_nutrition ->> 'calories')::NUMERIC,
     (v_nutrition ->> 'protein')::NUMERIC,
     (v_nutrition ->> 'carbs')::NUMERIC,
     (v_nutrition ->> 'fat')::NUMERIC,
     (v_nutrition ->> 'fiber')::NUMERIC,
     (v_nutrition ->> 'sodium')::NUMERIC,
     v_nutrition, v_vitamins,
     -- Approved by a human, so it earns the verified mark that ranking and
     -- the search badge both read.
     TRUE, 'member_request')
  RETURNING id INTO v_new_id;

  UPDATE public.food_item_requests
     SET status = 'approved',
         reviewed_at = now(),
         reviewed_by = auth.uid(),
         approved_item_id = v_new_id
   WHERE id = p_request_id;

  RETURN v_new_id;
END;
$$;

REVOKE ALL ON FUNCTION public.approve_food_item_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_food_item_request(UUID) TO authenticated;

-- ── 4. Reject ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_food_item_request(p_request_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_app_admin(auth.uid()) THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;
  UPDATE public.food_item_requests
     SET status = 'rejected',
         reviewed_at = now(),
         reviewed_by = auth.uid()
   WHERE id = p_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_food_item_request(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_food_item_request(UUID) TO authenticated;

-- ── 5. One row per barcode in the catalogue itself ──────────────────
-- Approval is the gate now, but nothing stopped two approved rows carrying
-- the same barcode, and `lookupCommunity` already sorts candidates by date
-- to cope with exactly that. Make it impossible instead. Partial, because
-- a hand-entered food legitimately has no barcode.
CREATE UNIQUE INDEX IF NOT EXISTS food_items_barcode_key
  ON public.food_items (barcode)
  WHERE barcode IS NOT NULL;

NOTIFY pgrst, 'reload schema';
