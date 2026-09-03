ALTER TYPE public.request_status ADD VALUE IF NOT EXISTS 'pending_review' BEFORE 'completed';
