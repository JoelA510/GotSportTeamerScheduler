-- Migration: Phase 8 Pre-requisite — Overloaded persist_evaluation_run RPC
-- Created: 2026-04-07
-- Description: Creates the (p_run_data, p_findings, p_metrics) overload that
--   fairness-scoring/index.ts (line 178) already calls. Also extends audit_log
--   action CHECK constraint for scheduler auto-generation events.

-- 1. Overloaded persist_evaluation_run with full findings + metrics support
--    PostgreSQL distinguishes overloads by parameter types, so this coexists
--    with the (UUID, TEXT, JSONB, INTEGER) version from Phase 7.
CREATE OR REPLACE FUNCTION public.persist_evaluation_run(
  p_run_data JSONB,
  p_findings JSONB DEFAULT '[]'::jsonb,
  p_metrics  JSONB DEFAULT '[]'::jsonb
)
RETURNS UUID AS $$
DECLARE
  v_run_id        UUID;
  v_org_id        UUID;
  v_finding       JSONB;
  v_metric        JSONB;
BEGIN
  -- Extract and validate organization_id
  v_org_id := (p_run_data->>'organization_id')::UUID;
  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'p_run_data must contain organization_id';
  END IF;

  -- Security check: auth.uid() must be a member of the organization
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = v_org_id
      AND profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of organization %', v_org_id;
  END IF;

  -- Insert evaluation_runs row from p_run_data
  INSERT INTO public.evaluation_runs (
    organization_id,
    scheduler_run_id,
    scheduler_run_type,
    season_settings_id,
    status,
    findings_severity,
    metrics_summary,
    input_snapshot,
    execution_time_ms,
    created_by,
    started_at,
    completed_at,
    created_at,
    updated_at
  ) VALUES (
    v_org_id,
    (p_run_data->>'scheduler_run_id')::UUID,
    p_run_data->>'scheduler_run_type',
    (p_run_data->>'season_settings_id')::UUID,
    COALESCE(p_run_data->>'status', 'completed'),
    COALESCE(p_run_data->>'findings_severity', 'none'),
    COALESCE(p_run_data->'metrics_summary', '{}'::jsonb),
    COALESCE(p_run_data->'input_snapshot', '{}'::jsonb),
    (p_run_data->>'execution_time_ms')::INTEGER,
    COALESCE((p_run_data->>'created_by')::UUID, auth.uid()),
    (p_run_data->>'started_at')::TIMESTAMPTZ,
    (p_run_data->>'completed_at')::TIMESTAMPTZ,
    NOW(),
    NOW()
  ) RETURNING id INTO v_run_id;

  -- Insert findings (array of JSONB objects)
  IF p_findings IS NOT NULL AND jsonb_array_length(p_findings) > 0 THEN
    FOR v_finding IN SELECT * FROM jsonb_array_elements(p_findings)
    LOOP
      INSERT INTO public.evaluation_findings (
        organization_id,
        evaluation_run_id,
        severity,
        finding_code,
        description,
        affected_entities
      ) VALUES (
        v_org_id,
        v_run_id,
        COALESCE(v_finding->>'severity', 'warning'),
        COALESCE(v_finding->>'finding_code', 'UNKNOWN'),
        COALESCE(v_finding->>'description', ''),
        COALESCE(v_finding->'affected_entities', '[]'::jsonb)
      );
    END LOOP;
  END IF;

  -- Insert metrics (array of JSONB objects)
  IF p_metrics IS NOT NULL AND jsonb_array_length(p_metrics) > 0 THEN
    FOR v_metric IN SELECT * FROM jsonb_array_elements(p_metrics)
    LOOP
      INSERT INTO public.evaluation_metrics (
        organization_id,
        evaluation_run_id,
        metric_key,
        metric_value,
        thresholds
      ) VALUES (
        v_org_id,
        v_run_id,
        v_metric->>'metric_key',
        (v_metric->>'metric_value')::NUMERIC,
        COALESCE(v_metric->'thresholds', '{}'::jsonb)
      );
    END LOOP;
  END IF;

  RETURN v_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.persist_evaluation_run(JSONB, JSONB, JSONB) TO authenticated;

COMMENT ON FUNCTION public.persist_evaluation_run(JSONB, JSONB, JSONB) IS
  'Atomically persists an evaluation run with findings and metrics. '
  'Validates auth.uid() membership in organization. '
  'Called by fairness-scoring and auto-scheduler Edge Functions.';

-- 2. Extend audit_log action CHECK to support evaluation and auto-scheduler events.
--    We drop and recreate the constraint (PostgreSQL does not support ALTER CHECK).
DO $$
BEGIN
  ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
  ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
    CHECK (action IN (
        'import.started', 'import.completed', 'import.failed',
        'team.saved', 'team.deleted',
        'game.saved', 'game.deleted',
        'practice.saved', 'practice.deleted',
        'registration.submitted', 'registration.approved', 'registration.rejected',
        'calendar.token_rotated',
        'member.invited', 'member.removed', 'member.role_changed',
        'settings.updated',
        'feature_flags.updated',
        'export.started', 'export.completed',
        'organization.onboarded',
        -- Phase 8: Evaluation & Auto-Scheduler
        'evaluation.run',
        'scheduler.auto_started',
        'scheduler.auto_progress',
        'scheduler.auto_completed',
        'scheduler.auto_failed'
    ));
END$$;
