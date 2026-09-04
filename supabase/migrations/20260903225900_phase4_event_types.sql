-- New semantic events; historical audit values remain intact.
ALTER TYPE public.job_event_type ADD VALUE IF NOT EXISTS 'status_changed';
