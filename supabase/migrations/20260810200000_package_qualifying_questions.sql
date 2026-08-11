-- Flat, ordered package intake questions and request-time answer snapshots.
-- Existing rule_question_key values on package_tiers continue to identify the
-- single question (if any) that selects a price level.

ALTER TABLE public.package_qualifying_questions
  ADD COLUMN IF NOT EXISTS is_required boolean NOT NULL DEFAULT true;

ALTER TABLE public.service_requests
  ADD COLUMN IF NOT EXISTS package_question_answers jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.service_requests
  DROP CONSTRAINT IF EXISTS service_requests_package_question_answers_object;

ALTER TABLE public.service_requests
  ADD CONSTRAINT service_requests_package_question_answers_object
  CHECK (jsonb_typeof(package_question_answers) = 'object');

COMMENT ON COLUMN public.package_qualifying_questions.is_required IS
  'Whether the homeowner must answer this flat package question before request submission.';

COMMENT ON COLUMN public.service_requests.package_question_answers IS
  'Request-time snapshot keyed by package qualifying question_key. Values are homeowner answers; question labels are included in each value object.';
