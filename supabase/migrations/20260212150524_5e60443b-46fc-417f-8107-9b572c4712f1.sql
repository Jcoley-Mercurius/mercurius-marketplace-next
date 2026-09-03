-- Extend app_role enum with new roles
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'homeowner';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'vendor';
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'business';
-- =============================================
-- PROFILES TABLE
-- =============================================
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  full_name text NOT NULL DEFAULT '',
  phone text,
  avatar_url text,
  address text,
  city text,
  state text DEFAULT 'TX',
  zip_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
-- Users can view their own profile
CREATE POLICY "Users can view own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);
-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));
-- Users can insert their own profile
CREATE POLICY "Users can insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);
-- Trigger for updated_at
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, full_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  -- Also assign default 'homeowner' role if no role specified
  INSERT INTO public.user_roles (user_id, role)
  VALUES (
    NEW.id,
    COALESCE(
      (NEW.raw_user_meta_data->>'role')::app_role,
      'homeowner'
    )
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
-- =============================================
-- SERVICE REQUESTS TABLE
-- =============================================
CREATE TYPE public.request_status AS ENUM (
  'pending', 'matched', 'scheduled', 'in_progress', 'completed', 'cancelled'
);
CREATE TABLE public.service_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  service_type text NOT NULL,
  description text,
  address text NOT NULL,
  city text NOT NULL DEFAULT 'Austin',
  state text NOT NULL DEFAULT 'TX',
  zip_code text,
  preferred_date date,
  preferred_time text,
  status request_status NOT NULL DEFAULT 'pending',
  total_amount numeric(10,2),
  platform_fee numeric(10,2),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.service_requests ENABLE ROW LEVEL SECURITY;
-- Customers can view their own requests
CREATE POLICY "Customers can view own requests"
  ON public.service_requests FOR SELECT
  USING (auth.uid() = customer_id);
-- Vendors can view requests assigned to them
CREATE POLICY "Vendors can view assigned requests"
  ON public.service_requests FOR SELECT
  USING (
    contractor_id IN (
      SELECT id FROM public.contractors WHERE email = (
        SELECT email FROM auth.users WHERE id = auth.uid()
      )
    )
  );
-- Admins can view all requests
CREATE POLICY "Admins can view all requests"
  ON public.service_requests FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));
-- Customers can create requests
CREATE POLICY "Customers can create requests"
  ON public.service_requests FOR INSERT
  WITH CHECK (auth.uid() = customer_id);
-- Admins can update any request
CREATE POLICY "Admins can update requests"
  ON public.service_requests FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));
-- Customers can update their own pending requests
CREATE POLICY "Customers can update own pending requests"
  ON public.service_requests FOR UPDATE
  USING (auth.uid() = customer_id AND status = 'pending');
-- Customers can cancel their own requests
CREATE POLICY "Customers can delete own requests"
  ON public.service_requests FOR DELETE
  USING (auth.uid() = customer_id AND status = 'pending');
-- Admins can delete any request
CREATE POLICY "Admins can delete requests"
  ON public.service_requests FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_service_requests_updated_at
  BEFORE UPDATE ON public.service_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
-- =============================================
-- INVOICES TABLE
-- =============================================
CREATE TYPE public.invoice_status AS ENUM (
  'draft', 'sent', 'paid', 'overdue', 'cancelled', 'refunded'
);
CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text NOT NULL UNIQUE,
  service_request_id uuid REFERENCES public.service_requests(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contractor_id uuid REFERENCES public.contractors(id) ON DELETE SET NULL,
  amount numeric(10,2) NOT NULL,
  platform_fee numeric(10,2) NOT NULL DEFAULT 0,
  vendor_payout numeric(10,2) NOT NULL DEFAULT 0,
  status invoice_status NOT NULL DEFAULT 'draft',
  due_date date,
  paid_at timestamptz,
  stripe_payment_id text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
-- Customers can view their own invoices
CREATE POLICY "Customers can view own invoices"
  ON public.invoices FOR SELECT
  USING (auth.uid() = customer_id);
-- Admins can view all invoices
CREATE POLICY "Admins can view all invoices"
  ON public.invoices FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));
-- Admins can manage invoices
CREATE POLICY "Admins can insert invoices"
  ON public.invoices FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update invoices"
  ON public.invoices FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================
CREATE INDEX idx_profiles_user_id ON public.profiles(user_id);
CREATE INDEX idx_service_requests_customer_id ON public.service_requests(customer_id);
CREATE INDEX idx_service_requests_contractor_id ON public.service_requests(contractor_id);
CREATE INDEX idx_service_requests_status ON public.service_requests(status);
CREATE INDEX idx_invoices_customer_id ON public.invoices(customer_id);
CREATE INDEX idx_invoices_service_request_id ON public.invoices(service_request_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
