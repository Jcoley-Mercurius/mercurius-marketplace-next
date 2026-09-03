-- ─── Tier enum ──────────────────────────────────────────
CREATE TYPE public.loyalty_tier AS ENUM ('bronze', 'silver', 'gold', 'platinum');
CREATE TYPE public.loyalty_source_type AS ENUM ('review', 'job', 'bundle', 'referral', 'redemption', 'profile', 'adjustment');
CREATE TYPE public.redemption_status AS ENUM ('pending', 'fulfilled', 'cancelled');
-- ─── Tier helper ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tier_for_points(_pts integer)
RETURNS public.loyalty_tier
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN _pts >= 5000 THEN 'platinum'::public.loyalty_tier
    WHEN _pts >= 2500 THEN 'gold'::public.loyalty_tier
    WHEN _pts >= 500  THEN 'silver'::public.loyalty_tier
    ELSE 'bronze'::public.loyalty_tier
  END
$$;
-- ─── loyalty_accounts ───────────────────────────────────
CREATE TABLE public.loyalty_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  points_balance integer NOT NULL DEFAULT 0,
  lifetime_points integer NOT NULL DEFAULT 0,
  current_tier public.loyalty_tier NOT NULL DEFAULT 'bronze',
  tier_updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.loyalty_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own loyalty account"
  ON public.loyalty_accounts FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Admins view all loyalty accounts"
  ON public.loyalty_accounts FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins manage loyalty accounts"
  ON public.loyalty_accounts FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_loyalty_accounts_updated
  BEFORE UPDATE ON public.loyalty_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- ─── loyalty_transactions ───────────────────────────────
CREATE TABLE public.loyalty_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  delta integer NOT NULL,
  reason text NOT NULL,
  source_type public.loyalty_source_type NOT NULL,
  source_id uuid,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_loyalty_tx_user ON public.loyalty_transactions(user_id, created_at DESC);
ALTER TABLE public.loyalty_transactions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own transactions"
  ON public.loyalty_transactions FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Admins view all transactions"
  ON public.loyalty_transactions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins insert transactions"
  ON public.loyalty_transactions FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
-- ─── loyalty_rewards (catalog) ──────────────────────────
CREATE TABLE public.loyalty_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'savings',
  points_cost integer NOT NULL,
  min_tier public.loyalty_tier NOT NULL DEFAULT 'bronze',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.loyalty_rewards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone views active rewards"
  ON public.loyalty_rewards FOR SELECT
  USING (is_active = true);
CREATE POLICY "Admins manage rewards"
  ON public.loyalty_rewards FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
CREATE TRIGGER trg_loyalty_rewards_updated
  BEFORE UPDATE ON public.loyalty_rewards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
-- ─── loyalty_redemptions ────────────────────────────────
CREATE TABLE public.loyalty_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  reward_id uuid NOT NULL REFERENCES public.loyalty_rewards(id),
  points_cost integer NOT NULL,
  status public.redemption_status NOT NULL DEFAULT 'pending',
  fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.loyalty_redemptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own redemptions"
  ON public.loyalty_redemptions FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users create own redemptions"
  ON public.loyalty_redemptions FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins view all redemptions"
  ON public.loyalty_redemptions FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins manage redemptions"
  ON public.loyalty_redemptions FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role));
-- ─── referrals ──────────────────────────────────────────
CREATE TABLE public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id uuid NOT NULL,
  referral_code text NOT NULL,
  referred_email text,
  referred_user_id uuid,
  signed_up_at timestamptz,
  first_service_at timestamptz,
  signup_points_awarded boolean NOT NULL DEFAULT false,
  service_points_awarded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_referrals_referrer ON public.referrals(referrer_user_id);
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own referrals"
  ON public.referrals FOR SELECT
  USING (auth.uid() = referrer_user_id);
CREATE POLICY "Users create own referrals"
  ON public.referrals FOR INSERT
  WITH CHECK (auth.uid() = referrer_user_id);
CREATE POLICY "Admins view all referrals"
  ON public.referrals FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));
-- ─── profiles.referral_code ─────────────────────────────
ALTER TABLE public.profiles ADD COLUMN referral_code text UNIQUE;
-- ─── Account recompute on transaction insert ────────────
CREATE OR REPLACE FUNCTION public.apply_loyalty_transaction()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_balance integer;
  new_lifetime integer;
  new_tier public.loyalty_tier;
  old_tier public.loyalty_tier;
BEGIN
  -- Ensure account exists
  INSERT INTO public.loyalty_accounts (user_id)
  VALUES (NEW.user_id)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT current_tier INTO old_tier
    FROM public.loyalty_accounts WHERE user_id = NEW.user_id;

  UPDATE public.loyalty_accounts
     SET points_balance = points_balance + NEW.delta,
         lifetime_points = lifetime_points + GREATEST(NEW.delta, 0),
         updated_at = now()
   WHERE user_id = NEW.user_id
   RETURNING points_balance, lifetime_points INTO new_balance, new_lifetime;

  new_tier := public.tier_for_points(new_lifetime);

  IF new_tier IS DISTINCT FROM old_tier THEN
    UPDATE public.loyalty_accounts
       SET current_tier = new_tier,
           tier_updated_at = now()
     WHERE user_id = NEW.user_id;
  END IF;

  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_apply_loyalty_tx
  AFTER INSERT ON public.loyalty_transactions
  FOR EACH ROW EXECUTE FUNCTION public.apply_loyalty_transaction();
-- ─── Internal: insert tx bypassing RLS ──────────────────
CREATE OR REPLACE FUNCTION public.award_points(
  _user_id uuid,
  _delta integer,
  _reason text,
  _source_type public.loyalty_source_type,
  _source_id uuid DEFAULT NULL,
  _metadata jsonb DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF _delta = 0 THEN RETURN; END IF;
  INSERT INTO public.loyalty_transactions (user_id, delta, reason, source_type, source_id, metadata)
  VALUES (_user_id, _delta, _reason, _source_type, _source_id, _metadata);
END;
$$;
-- ─── Reviews → +50 points if comment >= 40 chars ────────
CREATE OR REPLACE FUNCTION public.award_review_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF length(coalesce(NEW.comment, '')) >= 40 THEN
    PERFORM public.award_points(
      NEW.customer_id, 50,
      'Verified review', 'review'::public.loyalty_source_type, NEW.id, NULL
    );
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_award_review_points
  AFTER INSERT ON public.reviews
  FOR EACH ROW EXECUTE FUNCTION public.award_review_points();
-- ─── Service request completed → +$ amount (cap 500) ────
CREATE OR REPLACE FUNCTION public.award_job_completion_points()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pts integer;
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    pts := LEAST(500, GREATEST(0, COALESCE(round(NEW.total_amount)::int, 0)));
    IF pts > 0 THEN
      PERFORM public.award_points(
        NEW.customer_id, pts,
        'Service completed', 'job'::public.loyalty_source_type, NEW.id,
        jsonb_build_object('total_amount', NEW.total_amount)
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_award_job_completion_points
  AFTER UPDATE ON public.service_requests
  FOR EACH ROW EXECUTE FUNCTION public.award_job_completion_points();
-- ─── Redemption → debit balance ─────────────────────────
CREATE OR REPLACE FUNCTION public.apply_redemption()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_balance integer;
BEGIN
  SELECT points_balance INTO current_balance
    FROM public.loyalty_accounts WHERE user_id = NEW.user_id;
  IF current_balance IS NULL OR current_balance < NEW.points_cost THEN
    RAISE EXCEPTION 'Insufficient points balance';
  END IF;
  PERFORM public.award_points(
    NEW.user_id, -NEW.points_cost,
    'Reward redeemed', 'redemption'::public.loyalty_source_type, NEW.id, NULL
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_apply_redemption
  AFTER INSERT ON public.loyalty_redemptions
  FOR EACH ROW EXECUTE FUNCTION public.apply_redemption();
-- ─── handle_new_user: account + referral_code ───────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_code text;
BEGIN
  new_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  INSERT INTO public.profiles (user_id, full_name, referral_code)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    new_code
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    COALESCE(
      (NEW.raw_user_meta_data->>'role')::app_role,
      'homeowner'
    )
  );

  INSERT INTO public.loyalty_accounts (user_id) VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;
-- ─── Backfill: existing users get accounts + codes ──────
INSERT INTO public.loyalty_accounts (user_id)
SELECT user_id FROM public.profiles
ON CONFLICT (user_id) DO NOTHING;
UPDATE public.profiles
   SET referral_code = upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
 WHERE referral_code IS NULL;
-- ─── Seed reward catalog ────────────────────────────────
INSERT INTO public.loyalty_rewards (name, description, category, points_cost, min_tier, sort_order) VALUES
  ('$25 off any bundle', 'Applied at next billing cycle', 'savings', 1200, 'bronze', 1),
  ('Free month — single service', 'Up to $250 value', 'savings', 2500, 'silver', 2),
  ('Free month — full bundle', 'Up to $750 value', 'savings', 5000, 'gold', 3),
  ('Priority 24-hour response', '90 days, any service', 'experiences', 1500, 'silver', 4),
  ('Hurricane prep kit', 'Delivered before June 1', 'experiences', 4000, 'gold', 5),
  ('AI feature preview access', '90 days, early beta access', 'exclusive', 2000, 'silver', 6),
  ('Upgrade bundle tier 30 days', 'One-tier upgrade, free', 'exclusive', 3500, 'gold', 7),
  ('Concierge home consult', '60-min call with a home expert', 'exclusive', 7500, 'platinum', 8);
