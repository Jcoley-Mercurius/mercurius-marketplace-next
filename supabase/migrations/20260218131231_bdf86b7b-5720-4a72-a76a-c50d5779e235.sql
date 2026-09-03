-- Create messages table scoped to service_requests
CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  service_request_id UUID NOT NULL REFERENCES public.service_requests(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  sender_role TEXT NOT NULL CHECK (sender_role IN ('homeowner', 'vendor', 'admin')),
  content TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  read_at TIMESTAMP WITH TIME ZONE
);
-- Enable RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
-- Homeowners can view messages on their own service requests
CREATE POLICY "Homeowners can view messages on own requests"
ON public.messages FOR SELECT
USING (
  service_request_id IN (
    SELECT id FROM public.service_requests WHERE customer_id = auth.uid()
  )
);
-- Vendors can view messages on requests assigned to them
CREATE POLICY "Vendors can view messages on assigned requests"
ON public.messages FOR SELECT
USING (
  service_request_id IN (
    SELECT sr.id FROM public.service_requests sr
    JOIN public.contractors c ON c.id = sr.contractor_id
    WHERE c.user_id = auth.uid()
  )
);
-- Admins can view all messages
CREATE POLICY "Admins can view all messages"
ON public.messages FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));
-- Homeowners can send messages on their own service requests
CREATE POLICY "Homeowners can send messages on own requests"
ON public.messages FOR INSERT
WITH CHECK (
  auth.uid() = sender_id AND
  service_request_id IN (
    SELECT id FROM public.service_requests WHERE customer_id = auth.uid()
  )
);
-- Vendors can send messages on requests assigned to them
CREATE POLICY "Vendors can send messages on assigned requests"
ON public.messages FOR INSERT
WITH CHECK (
  auth.uid() = sender_id AND
  service_request_id IN (
    SELECT sr.id FROM public.service_requests sr
    JOIN public.contractors c ON c.id = sr.contractor_id
    WHERE c.user_id = auth.uid()
  )
);
-- Admins can send messages on any request
CREATE POLICY "Admins can send messages"
ON public.messages FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));
-- Enable realtime for messages
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
