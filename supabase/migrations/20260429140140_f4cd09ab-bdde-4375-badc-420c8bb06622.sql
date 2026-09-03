ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_customer_id text UNIQUE;
