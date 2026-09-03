ALTER TABLE public.contractors 
  ADD COLUMN special_offer text DEFAULT NULL,
  ADD COLUMN our_promise text DEFAULT NULL,
  ADD COLUMN verified_specialty text DEFAULT NULL;
