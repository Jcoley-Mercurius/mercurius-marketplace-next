CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE TABLE IF NOT EXISTS public.internal_worker_tokens (
  name text PRIMARY KEY,
  token text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.internal_worker_tokens FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.internal_worker_tokens TO service_role;
ALTER TABLE public.internal_worker_tokens ENABLE ROW LEVEL SECURITY;
-- Intentionally no policies: anon/authenticated have zero access.

CREATE TRIGGER update_internal_worker_tokens_updated_at
BEFORE UPDATE ON public.internal_worker_tokens
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
INSERT INTO public.internal_worker_tokens (name, token)
VALUES ('job-lifecycle-worker', encode(extensions.gen_random_bytes(32), 'hex'))
ON CONFLICT (name) DO NOTHING;
