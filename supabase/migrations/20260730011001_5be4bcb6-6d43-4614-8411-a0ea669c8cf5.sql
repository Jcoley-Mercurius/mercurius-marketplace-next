CREATE OR REPLACE FUNCTION public.submit_job_review(_job_id uuid, _rating integer, _comment text)
 RETURNS TABLE(review_id uuid, visibility review_visibility)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE j record; vendor_user uuid; vis public.review_visibility; r_id uuid;
BEGIN
  IF _rating < 1 OR _rating > 5 THEN RAISE EXCEPTION 'Rating must be between 1 and 5'; END IF;

  SELECT sr.*, c.user_id AS vendor_user_id INTO j
  FROM public.service_requests sr
  LEFT JOIN public.contractors c ON c.id = sr.contractor_id
  WHERE sr.id = _job_id;

  IF j IS NULL THEN RAISE EXCEPTION 'Job not found'; END IF;
  IF j.customer_id <> auth.uid() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF j.contractor_id IS NULL THEN RAISE EXCEPTION 'Job has no assigned vendor'; END IF;

  vis := CASE WHEN _rating >= 4 THEN 'eligible_for_google'::public.review_visibility
              ELSE 'internal_only'::public.review_visibility END;

  INSERT INTO public.reviews (service_request_id, customer_id, contractor_id, rating, comment, visibility)
  VALUES (_job_id, auth.uid(), j.contractor_id, _rating, NULLIF(btrim(coalesce(_comment,'')), ''), vis)
  RETURNING id INTO r_id;

  PERFORM public.transition_job_status(_job_id, 'reviewed'::request_status, NULL,
    jsonb_build_object('rating', _rating, 'visibility', vis));

  vendor_user := j.vendor_user_id;
  IF _rating < 4 AND vendor_user IS NOT NULL THEN
    PERFORM public.notify_user(vendor_user, 'internal_review', 'warning',
      'New internal review needs your attention',
      'A homeowner left a ' || _rating || '-star internal review. Please contact them to resolve it.',
      '/vendor/dashboard', _job_id, j.contractor_id);
  END IF;

  RETURN QUERY SELECT r_id, vis;
END;
$function$;
UPDATE public.notifications
   SET link = '/vendor/dashboard'
 WHERE link = '/vendor/overview';
