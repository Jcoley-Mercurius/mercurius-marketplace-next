REVOKE EXECUTE ON FUNCTION public.award_points(uuid, integer, text, public.loyalty_source_type, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_loyalty_transaction() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_redemption() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_review_points() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.award_job_completion_points() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.tier_for_points(integer) FROM PUBLIC, anon;
