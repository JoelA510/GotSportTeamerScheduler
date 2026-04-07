-- Migration: Phase 7 Analytics Persistence & Hardening
-- Created: 2026-04-06
-- Description: Adds missing columns, pruning logic, and secure RPC for evaluation runs.

/*
  Zod Schema for metrics_summary:
  const EvaluationMetricsSchema = z.object({
    fairnessIndex: z.number().min(0).max(1),
    conflictCount: z.number().int().min(0),
    executionTimeMs: z.number().int().min(0).optional(),
    foundations: z.record(z.string(), z.number()).optional()
  });
*/

-- 1. Update evaluation_runs table
ALTER TABLE public.evaluation_runs 
ADD COLUMN IF NOT EXISTS execution_time_ms INTEGER;

-- 2. Ensure organizations has settings for retention
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS settings JSONB DEFAULT '{ "retention_days": 365 }'::jsonb;

-- 3. Pruning Function
CREATE OR REPLACE FUNCTION public.prune_old_evaluation_runs()
RETURNS VOID AS $$
DECLARE
    org_rec RECORD;
BEGIN
    FOR org_rec IN SELECT id, settings FROM public.organizations LOOP
        DELETE FROM public.evaluation_runs
        WHERE organization_id = org_rec.id
          AND created_at < (NOW() - (COALESCE((org_rec.settings->>'retention_days')::INTEGER, 365) || ' days')::INTERVAL);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Secure Persistence RPC (Overloaded version for Remediation Plan)
CREATE OR REPLACE FUNCTION public.persist_evaluation_run(
  p_org_id UUID,
  p_type TEXT,
  p_metrics JSONB,
  p_duration INTEGER
)
RETURNS UUID AS $$
DECLARE
  v_run_id UUID;
BEGIN
  -- Security check: auth.uid() must be a member of the organization
  IF NOT EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_id = p_org_id
      AND profile_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Not authorized: User is not a member of organization %', p_org_id;
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
    NOW(),
    NOW()
  ) RETURNING id INTO v_run_id;

  RETURN v_run_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant access to authenticated users
GRANT EXECUTE ON FUNCTION public.persist_evaluation_run(UUID, TEXT, JSONB, INTEGER) TO authenticated;

COMMENT ON FUNCTION public.persist_evaluation_run(UUID, TEXT, JSONB, INTEGER) IS 'Securely persists an evaluation run. Validates auth.uid() membership in organization.';
