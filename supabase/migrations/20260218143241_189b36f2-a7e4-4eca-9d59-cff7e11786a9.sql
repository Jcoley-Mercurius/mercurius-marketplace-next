ALTER TABLE public.contractors ADD COLUMN IF NOT EXISTS marketing_enabled boolean NOT NULL DEFAULT false;
