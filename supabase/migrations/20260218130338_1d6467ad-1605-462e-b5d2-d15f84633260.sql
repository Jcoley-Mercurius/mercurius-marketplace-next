-- Create support_tickets table
CREATE TABLE public.support_tickets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  ticket_number text NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  issue_type text NOT NULL,
  job_id text,
  status text NOT NULL DEFAULT 'open',
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);
-- Auto-increment ticket number via sequence
CREATE SEQUENCE public.support_ticket_seq START 1;
-- Auto-generate ticket number on insert
CREATE OR REPLACE FUNCTION public.set_ticket_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.ticket_number := 'TKT-' || LPAD(nextval('public.support_ticket_seq')::text, 3, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;
CREATE TRIGGER set_ticket_number_trigger
BEFORE INSERT ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.set_ticket_number();
-- updated_at trigger
CREATE TRIGGER update_support_tickets_updated_at
BEFORE UPDATE ON public.support_tickets
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- Enable RLS
ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;
-- Users can only view their own tickets
CREATE POLICY "Users can view own tickets"
ON public.support_tickets FOR SELECT
USING (auth.uid() = user_id);
-- Users can only create tickets for themselves
CREATE POLICY "Users can create own tickets"
ON public.support_tickets FOR INSERT
WITH CHECK (auth.uid() = user_id);
-- Users can update their own open tickets
CREATE POLICY "Users can update own open tickets"
ON public.support_tickets FOR UPDATE
USING (auth.uid() = user_id);
-- Admins can view all tickets
CREATE POLICY "Admins can view all tickets"
ON public.support_tickets FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));
-- Admins can update all tickets
CREATE POLICY "Admins can update all tickets"
ON public.support_tickets FOR UPDATE
USING (has_role(auth.uid(), 'admin'::app_role));
