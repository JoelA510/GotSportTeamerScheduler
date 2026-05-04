-- Emergency rollback for 20260504090000_drop_legacy_evaluation_run_overload.sql.
--
-- Recreates the legacy Phase 7 public.persist_evaluation_run(uuid, text, jsonb,
-- integer) overload. Prefer rolling the application forward because current
-- Edge Functions use public.persist_evaluation_run(jsonb, jsonb, jsonb).

\set ON_ERROR_STOP on

BEGIN;

CREATE OR REPLACE FUNCTION public.persist_evaluation_run(
  p_org_id uuid,
  p_type text,
  p_metrics jsonb,
  p_duration integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run_id uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members
    WHERE organization_id = p_org_id
      AND profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Access denied: user is not a member of organization %', p_org_id
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.evaluation_runs (
    organization_id,
    scheduler_run_type,
    metrics_summary,
    execution_time_ms,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_org_id,
    p_type,
    p_metrics,
    p_duration,
    'completed',
    now(),
    now()
  ) RETURNING id INTO v_run_id;

  RETURN v_run_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.persist_evaluation_run(uuid, text, jsonb, integer) TO authenticated;

COMMENT ON FUNCTION public.persist_evaluation_run(uuid, text, jsonb, integer) IS
  'Legacy evaluation persistence overload restored by rollback. Validates auth.uid() membership in organization.';

COMMIT;
