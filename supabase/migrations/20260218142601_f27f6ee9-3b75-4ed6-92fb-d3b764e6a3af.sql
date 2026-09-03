-- Create home_profiles table for full property profiles
CREATE TABLE public.home_profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  -- Property basics
  property_type TEXT NOT NULL DEFAULT 'house', -- house | condo | townhome | mobile
  home_age_range TEXT NOT NULL DEFAULT 'unknown', -- pre1980 | 1980s | 1990s | 2000s | 2010s | newer
  square_footage TEXT NOT NULL DEFAULT 'medium', -- small(<1500) | medium(1500-3000) | large(3000-5000) | xlarge(5000+)
  bedrooms INTEGER DEFAULT 3,
  bathrooms NUMERIC(3,1) DEFAULT 2.0,
  -- Outdoor features (boolean flags)
  has_pool BOOLEAN DEFAULT false,
  has_yard BOOLEAN DEFAULT false,
  has_deck_patio BOOLEAN DEFAULT false,
  has_fence BOOLEAN DEFAULT false,
  has_irrigation BOOLEAN DEFAULT false,
  has_trees BOOLEAN DEFAULT false,
  -- Situation
  ownership_type TEXT NOT NULL DEFAULT 'primary', -- primary | rental | vacation
  ownership_duration TEXT NOT NULL DEFAULT 'established', -- new(<1yr) | recent(1-3yr) | established(3+yr)
  -- Completion state
  is_complete BOOLEAN DEFAULT false,
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);
-- Enable RLS
ALTER TABLE public.home_profiles ENABLE ROW LEVEL SECURITY;
-- Policies
CREATE POLICY "Users can view own home profile"
  ON public.home_profiles FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own home profile"
  ON public.home_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own home profile"
  ON public.home_profiles FOR UPDATE
  USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own home profile"
  ON public.home_profiles FOR DELETE
  USING (auth.uid() = user_id);
-- Admins can view all
CREATE POLICY "Admins can view all home profiles"
  ON public.home_profiles FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));
-- Updated_at trigger
CREATE TRIGGER update_home_profiles_updated_at
  BEFORE UPDATE ON public.home_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
