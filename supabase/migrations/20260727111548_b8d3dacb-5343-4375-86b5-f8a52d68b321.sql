-- New enum types
CREATE TYPE public.job_payment_status AS ENUM ('pending','captured','released','refunded');
CREATE TYPE public.review_visibility AS ENUM ('internal_only','eligible_for_google');
CREATE TYPE public.dispute_status AS ENUM ('open','vendor_contacted','resolved','escalated');
CREATE TYPE public.job_event_type AS ENUM (
  'job_completed_by_vendor','confirmation_sent','confirmation_received',
  'dispute_opened','dispute_resolved','review_requested','review_submitted',
  'vendor_reminder_sent','auto_completed_by_timer','flagged_for_admin_review'
);
-- Extend the existing request status enum
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'vendor_completed';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'homeowner_confirmed';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'disputed';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'resolved';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'review_requested';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'reviewed';
ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'closed';
-- Job lifecycle columns
ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS vendor_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS photo_proof_urls text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS homeowner_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_status public.job_payment_status NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_captured_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS confirmation_deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_request_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS vendor_reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS needs_admin_review boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/New_York';
-- Review columns
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS visibility public.review_visibility NOT NULL DEFAULT 'internal_only',
  ADD COLUMN IF NOT EXISTS google_prompt_shown boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_prompt_clicked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vendor_acknowledged_at timestamptz;
-- Disputes
CREATE TABLE IF NOT EXISTS public.disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  homeowner_id uuid NOT NULL,
  vendor_id uuid,
  reason text,
  status public.dispute_status NOT NULL DEFAULT 'open',
  raised_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.disputes TO authenticated;
GRANT ALL ON public.disputes TO service_role;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Homeowners view own disputes" ON public.disputes
  FOR SELECT TO authenticated USING (homeowner_id = auth.uid());
CREATE POLICY "Vendors view disputes on their jobs" ON public.disputes
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.contractors c WHERE c.id = disputes.vendor_id AND c.user_id = auth.uid())
  );
CREATE POLICY "Admins view all disputes" ON public.disputes
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Homeowners open disputes on own jobs" ON public.disputes
  FOR INSERT TO authenticated WITH CHECK (
    homeowner_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.id = job_id AND sr.customer_id = auth.uid())
  );
CREATE POLICY "Admins update disputes" ON public.disputes
  FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_disputes_updated_at BEFORE UPDATE ON public.disputes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- Job events (audit log)
CREATE TABLE IF NOT EXISTS public.job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  event_type public.job_event_type NOT NULL,
  actor_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.job_events TO authenticated;
GRANT ALL ON public.job_events TO service_role;
ALTER TABLE public.job_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Job parties view events" ON public.job_events
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.id = job_events.job_id AND sr.customer_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.service_requests sr
      JOIN public.contractors c ON c.id = sr.contractor_id
      WHERE sr.id = job_events.job_id AND c.user_id = auth.uid()
    )
  );
CREATE POLICY "Job parties log events" ON public.job_events
  FOR INSERT TO authenticated WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (SELECT 1 FROM public.service_requests sr WHERE sr.id = job_events.job_id AND sr.customer_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.service_requests sr
      JOIN public.contractors c ON c.id = sr.contractor_id
      WHERE sr.id = job_events.job_id AND c.user_id = auth.uid()
    )
  );
CREATE INDEX IF NOT EXISTS idx_job_events_job ON public.job_events(job_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON public.disputes(status, raised_at DESC);
CREATE INDEX IF NOT EXISTS idx_sr_confirmation_due ON public.service_requests(confirmation_due_at) WHERE confirmation_due_at IS NOT NULL;
