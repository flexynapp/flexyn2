-- 139_gym_event_rsvps.sql
--
-- Event RSVPs. Three statuses: 'going' | 'maybe' | 'cant'. One row
-- per (event, user) — toggling the same status removes the RSVP,
-- switching status updates in place. Counter on gym_events.rsvp_count
-- already exists (mig 135); a trigger keeps it as "going" count
-- specifically (the headline number members see on the event card).

CREATE TABLE IF NOT EXISTS public.gym_event_rsvps (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id    UUID NOT NULL REFERENCES public.gym_events(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      TEXT NOT NULL CHECK (status IN ('going', 'maybe', 'cant')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE INDEX IF NOT EXISTS gym_event_rsvps_event_idx
  ON public.gym_event_rsvps (event_id);

ALTER TABLE public.gym_event_rsvps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rsvp: members read"   ON public.gym_event_rsvps;
DROP POLICY IF EXISTS "rsvp: own write"      ON public.gym_event_rsvps;
DROP POLICY IF EXISTS "rsvp: own update"     ON public.gym_event_rsvps;
DROP POLICY IF EXISTS "rsvp: own delete"     ON public.gym_event_rsvps;

CREATE POLICY "rsvp: members read"
  ON public.gym_event_rsvps FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.gym_events ge
        JOIN public.gym_members gm ON gm.gym_id = ge.gym_id
       WHERE ge.id = gym_event_rsvps.event_id
         AND gm.user_id = auth.uid()
    )
  );

CREATE POLICY "rsvp: own write"
  ON public.gym_event_rsvps FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "rsvp: own update"
  ON public.gym_event_rsvps FOR UPDATE TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "rsvp: own delete"
  ON public.gym_event_rsvps FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.gym_event_rsvps TO authenticated;

-- Counter sync — track "going" specifically; "maybe" and "cant" stay
-- in the row but don't bump the headline number on event cards.
CREATE OR REPLACE FUNCTION public.gym_event_rsvp_count_sync()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'going' THEN
      UPDATE public.gym_events
         SET rsvp_count = COALESCE(rsvp_count, 0) + 1
       WHERE id = NEW.event_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.status = 'going' AND NEW.status <> 'going' THEN
      UPDATE public.gym_events
         SET rsvp_count = GREATEST(0, COALESCE(rsvp_count, 0) - 1)
       WHERE id = NEW.event_id;
    ELSIF OLD.status <> 'going' AND NEW.status = 'going' THEN
      UPDATE public.gym_events
         SET rsvp_count = COALESCE(rsvp_count, 0) + 1
       WHERE id = NEW.event_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status = 'going' THEN
      UPDATE public.gym_events
         SET rsvp_count = GREATEST(0, COALESCE(rsvp_count, 0) - 1)
       WHERE id = OLD.event_id;
    END IF;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_gym_event_rsvp_count ON public.gym_event_rsvps;
CREATE TRIGGER trg_gym_event_rsvp_count
  AFTER INSERT OR UPDATE OR DELETE ON public.gym_event_rsvps
  FOR EACH ROW EXECUTE FUNCTION public.gym_event_rsvp_count_sync();

-- Batch reader — returns every RSVP for a set of events. Used by the
-- events tab to render each card's count + the caller's own status.
CREATE OR REPLACE FUNCTION public.get_gym_event_rsvps_bulk(p_event_ids UUID[])
RETURNS TABLE (event_id UUID, user_id UUID, status TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT event_id, user_id, status
    FROM public.gym_event_rsvps
   WHERE event_id = ANY(p_event_ids);
$$;

REVOKE ALL ON FUNCTION public.get_gym_event_rsvps_bulk(UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_gym_event_rsvps_bulk(UUID[]) TO authenticated;

NOTIFY pgrst, 'reload schema';
