-- Same publication treatment for every rating; preserve previously private feedback.
ALTER TABLE public.reviews ADD COLUMN moderation_state text NOT NULL DEFAULT 'published'
  CHECK(moderation_state IN ('published','held_for_moderation','rejected','appealed'));
UPDATE public.reviews SET moderation_state='held_for_moderation' WHERE visibility='internal_only';
REVOKE INSERT,UPDATE,DELETE ON public.reviews FROM authenticated;
DROP POLICY "Public can view shareable reviews" ON public.reviews;
CREATE POLICY "Public can view shareable reviews" ON public.reviews FOR SELECT TO anon,authenticated
  USING(visibility='eligible_for_google' AND moderation_state='published');
CREATE TABLE public.review_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  review_id uuid NOT NULL REFERENCES public.reviews(id),
  actor_id uuid NOT NULL,
  action text NOT NULL,
  before_value jsonb NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.review_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.review_history FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.review_history TO authenticated;
GRANT ALL ON public.review_history TO service_role;
CREATE POLICY "Review owner and admin see history" ON public.review_history FOR SELECT TO authenticated USING
  (public.has_role(auth.uid(),'admin') OR EXISTS(SELECT 1 FROM public.reviews r WHERE r.id=review_id AND r.customer_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.submit_job_review(_job_id uuid,_rating integer,_comment text)
RETURNS TABLE(review_id uuid,visibility public.review_visibility)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE r public.service_requests; r_id uuid;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(_job_id::text,0));
  SELECT * INTO r FROM public.service_requests WHERE id=_job_id FOR UPDATE;
  IF auth.uid() IS NULL OR r.customer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the homeowner can review this service' USING ERRCODE='42501'; END IF;
  IF _rating IS NULL OR _rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'Rating must be between 1 and 5' USING ERRCODE='22023'; END IF;
  IF r.contractor_id IS NULL OR r.homeowner_confirmed_at IS NULL OR r.status NOT IN ('completed','review_requested') THEN RAISE EXCEPTION 'A completed confirmed service is required' USING ERRCODE='22023'; END IF;
  IF EXISTS(SELECT 1 FROM public.reviews WHERE service_request_id=r.id) THEN RAISE EXCEPTION 'This service already has a review' USING ERRCODE='22023'; END IF;
  INSERT INTO public.reviews(service_request_id,customer_id,contractor_id,rating,comment,visibility,moderation_state)
    VALUES(r.id,auth.uid(),r.contractor_id,_rating,NULLIF(btrim(_comment),''),'eligible_for_google','published') RETURNING id INTO r_id;
  PERFORM public.transition_job_status(r.id,'reviewed',NULL,jsonb_build_object('review_id',r_id));
  RETURN QUERY SELECT r_id,'eligible_for_google'::public.review_visibility;
END;
$$;

CREATE FUNCTION public.revise_job_review(_review_id uuid,_rating integer,_comment text,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE r public.reviews;
BEGIN
  SELECT * INTO r FROM public.reviews WHERE id=_review_id FOR UPDATE;
  IF auth.uid() IS NULL OR r.customer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the review author can edit it' USING ERRCODE='42501'; END IF;
  IF _rating IS NULL OR _rating NOT BETWEEN 1 AND 5 OR NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Valid rating and correction reason required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.review_history(review_id,actor_id,action,before_value,reason) VALUES(r.id,auth.uid(),'corrected',to_jsonb(r),btrim(_reason));
  UPDATE public.reviews SET rating=_rating,comment=NULLIF(btrim(_comment),'') WHERE id=r.id;
END;
$$;

CREATE FUNCTION public.moderate_job_review(_review_id uuid,_state text,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE r public.reviews;
BEGIN
  IF NOT COALESCE(public.has_role(auth.uid(),'admin'),false) THEN RAISE EXCEPTION 'Admin access required' USING ERRCODE='42501'; END IF;
  IF _state NOT IN ('published','held_for_moderation','rejected') OR NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Moderation state and reason required' USING ERRCODE='22023'; END IF;
  SELECT * INTO r FROM public.reviews WHERE id=_review_id FOR UPDATE;
  IF r.id IS NULL OR r.moderation_state=_state THEN RAISE EXCEPTION 'Invalid or duplicate moderation' USING ERRCODE='22023'; END IF;
  IF _state='published' AND r.visibility='internal_only' THEN RAISE EXCEPTION 'Legacy private feedback cannot be published without author consent' USING ERRCODE='42501'; END IF;
  INSERT INTO public.review_history(review_id,actor_id,action,before_value,reason) VALUES(r.id,auth.uid(),_state,to_jsonb(r),btrim(_reason));
  UPDATE public.reviews SET moderation_state=_state WHERE id=r.id;
  PERFORM public.notify_user(r.customer_id,'job_status','info','Review moderation updated',btrim(_reason),'/dashboard',r.service_request_id,r.contractor_id);
END;
$$;

CREATE FUNCTION public.appeal_job_review(_review_id uuid,_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,private,pg_temp AS $$
DECLARE r public.reviews;
BEGIN
  SELECT * INTO r FROM public.reviews WHERE id=_review_id FOR UPDATE;
  IF auth.uid() IS NULL OR r.customer_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'Only the review author can appeal' USING ERRCODE='42501'; END IF;
  IF r.moderation_state NOT IN ('held_for_moderation','rejected') OR NULLIF(btrim(_reason),'') IS NULL THEN RAISE EXCEPTION 'Moderation decision and appeal reason required' USING ERRCODE='22023'; END IF;
  INSERT INTO public.review_history(review_id,actor_id,action,before_value,reason) VALUES(r.id,auth.uid(),'appealed',to_jsonb(r),btrim(_reason));
  UPDATE public.reviews SET moderation_state='appealed' WHERE id=r.id;
  INSERT INTO public.support_tickets(user_id,subject,description,issue_type,job_id,next_action)
    VALUES(auth.uid(),'Review moderation appeal',btrim(_reason),'review_appeal',r.service_request_id::text,'Review original content and moderation reason');
END;
$$;
REVOKE ALL ON FUNCTION public.revise_job_review(uuid,integer,text,text),public.moderate_job_review(uuid,text,text),public.appeal_job_review(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.revise_job_review(uuid,integer,text,text),public.moderate_job_review(uuid,text,text),public.appeal_job_review(uuid,text) TO authenticated;
