-- 1. Add frequency to service_requests
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS frequency text NOT NULL DEFAULT 'one-time';
-- 2. job_visits table
CREATE TABLE IF NOT EXISTS public.job_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_request_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  visit_number integer NOT NULL,
  scheduled_date date NOT NULL,
  status text NOT NULL DEFAULT 'scheduled', -- scheduled | in_progress | completed | skipped
  vendor_notes text,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (service_request_id, visit_number)
);
CREATE INDEX IF NOT EXISTS idx_job_visits_request ON public.job_visits(service_request_id);
CREATE INDEX IF NOT EXISTS idx_job_visits_date ON public.job_visits(scheduled_date);
ALTER TABLE public.job_visits ENABLE ROW LEVEL SECURITY;
-- updated_at trigger
DROP TRIGGER IF EXISTS trg_job_visits_updated_at ON public.job_visits;
CREATE TRIGGER trg_job_visits_updated_at
  BEFORE UPDATE ON public.job_visits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- RLS
CREATE POLICY "Homeowners view visits on own requests"
  ON public.job_visits FOR SELECT
  USING (service_request_id IN (
    SELECT id FROM public.service_requests WHERE customer_id = auth.uid()
  ));
CREATE POLICY "Vendors view visits on assigned requests"
  ON public.job_visits FOR SELECT
  USING (service_request_id IN (
    SELECT sr.id FROM public.service_requests sr
    JOIN public.contractors c ON c.id = sr.contractor_id
    WHERE c.user_id = auth.uid()
  ));
CREATE POLICY "Vendors update visits on assigned requests"
  ON public.job_visits FOR UPDATE
  USING (service_request_id IN (
    SELECT sr.id FROM public.service_requests sr
    JOIN public.contractors c ON c.id = sr.contractor_id
    WHERE c.user_id = auth.uid()
  ));
CREATE POLICY "Admins manage visits"
  ON public.job_visits FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "System can insert visits"
  ON public.job_visits FOR INSERT
  WITH CHECK (true);
-- 3. Link job_photos to a specific visit (optional)
ALTER TABLE public.job_photos
  ADD COLUMN IF NOT EXISTS job_visit_id uuid REFERENCES public.job_visits(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_job_photos_visit ON public.job_photos(job_visit_id);
-- 4. Auto-generate visits when a recurring request is scheduled
CREATE OR REPLACE FUNCTION public.generate_recurring_visits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  start_date date;
  i integer;
BEGIN
  IF NEW.frequency IN ('monthly','weekly')
     AND NEW.status IN ('scheduled','in_progress')
     AND NOT EXISTS (
       SELECT 1 FROM public.job_visits WHERE service_request_id = NEW.id
     ) THEN

    start_date := COALESCE(NEW.preferred_date, CURRENT_DATE);

    FOR i IN 1..3 LOOP
      INSERT INTO public.job_visits (service_request_id, visit_number, scheduled_date, status)
      VALUES (
        NEW.id,
        i,
        CASE WHEN NEW.frequency = 'weekly'
             THEN start_date + ((i-1) * 7)
             ELSE (start_date + ((i-1) || ' months')::interval)::date
        END,
        'scheduled'
      );
    END LOOP;

  -- One-time: ensure a single visit row exists when scheduled
  ELSIF NEW.frequency = 'one-time'
     AND NEW.status IN ('scheduled','in_progress')
     AND NOT EXISTS (
       SELECT 1 FROM public.job_visits WHERE service_request_id = NEW.id
     ) THEN
    INSERT INTO public.job_visits (service_request_id, visit_number, scheduled_date, status)
    VALUES (NEW.id, 1, COALESCE(NEW.preferred_date, CURRENT_DATE), 'scheduled');
  END IF;

  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_generate_recurring_visits ON public.service_requests;
CREATE TRIGGER trg_generate_recurring_visits
  AFTER INSERT OR UPDATE OF status, frequency, preferred_date
  ON public.service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_recurring_visits();
-- 5. After completing a visit on a recurring job, top up to keep 3 future visits in the rolling window
CREATE OR REPLACE FUNCTION public.top_up_recurring_visits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  req record;
  future_count integer;
  last_date date;
  next_num integer;
  to_add integer;
  i integer;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    SELECT id, frequency INTO req
      FROM public.service_requests WHERE id = NEW.service_request_id;

    IF req.frequency NOT IN ('monthly','weekly') THEN
      RETURN NEW;
    END IF;

    SELECT COUNT(*), COALESCE(MAX(scheduled_date), CURRENT_DATE), COALESCE(MAX(visit_number), 0)
      INTO future_count, last_date, next_num
      FROM public.job_visits
     WHERE service_request_id = NEW.service_request_id
       AND status = 'scheduled'
       AND scheduled_date >= CURRENT_DATE;

    to_add := 3 - future_count;
    IF to_add > 0 THEN
      FOR i IN 1..to_add LOOP
        next_num := next_num + 1;
        last_date := CASE WHEN req.frequency = 'weekly'
                          THEN last_date + 7
                          ELSE (last_date + interval '1 month')::date
                     END;
        INSERT INTO public.job_visits (service_request_id, visit_number, scheduled_date, status)
        VALUES (NEW.service_request_id, next_num, last_date, 'scheduled')
        ON CONFLICT DO NOTHING;
      END LOOP;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_top_up_recurring_visits ON public.job_visits;
CREATE TRIGGER trg_top_up_recurring_visits
  AFTER UPDATE OF status ON public.job_visits
  FOR EACH ROW EXECUTE FUNCTION public.top_up_recurring_visits();
-- 6. Backfill: create visits for existing scheduled/in_progress requests that have none
INSERT INTO public.job_visits (service_request_id, visit_number, scheduled_date, status)
SELECT sr.id, 1, COALESCE(sr.preferred_date, CURRENT_DATE), 'scheduled'
FROM public.service_requests sr
WHERE sr.status IN ('scheduled','in_progress')
  AND NOT EXISTS (SELECT 1 FROM public.job_visits jv WHERE jv.service_request_id = sr.id);
