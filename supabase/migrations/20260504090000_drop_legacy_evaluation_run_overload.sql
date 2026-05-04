-- Drop the legacy Phase 7 evaluation persistence overload.
--
-- The JSONB overload remains the supported contract used by fairness-scoring
-- and auto-scheduler:
--   public.persist_evaluation_run(jsonb, jsonb, jsonb)

DROP FUNCTION IF EXISTS public.persist_evaluation_run(uuid, text, jsonb, integer);
