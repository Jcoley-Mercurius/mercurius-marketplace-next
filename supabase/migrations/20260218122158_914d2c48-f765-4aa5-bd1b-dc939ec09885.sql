-- Add user_id to contractors table so vendors can own their record
ALTER TABLE public.contractors 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_contractors_user_id ON public.contractors(user_id);
-- Update RLS: vendors can view and update their own contractor record
CREATE POLICY "Vendors can view own contractor record"
ON public.contractors
FOR SELECT
USING (auth.uid() = user_id);
CREATE POLICY "Vendors can update own contractor record"
ON public.contractors
FOR UPDATE
USING (auth.uid() = user_id);
-- Update service_requests RLS so vendors can update status of their assigned jobs
CREATE POLICY "Vendors can update assigned requests"
ON public.service_requests
FOR UPDATE
USING (
  contractor_id IN (
    SELECT id FROM public.contractors WHERE user_id = auth.uid()
  )
);
