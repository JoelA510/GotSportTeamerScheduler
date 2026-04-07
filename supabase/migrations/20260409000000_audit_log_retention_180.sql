-- Migration: Add audit_log retention pruning (180 days)
-- Phase 9 — Production Hardening
-- Created: 2026-04-09
--
-- The audit_log receives high-frequency scheduler.auto_progress events.
-- Without pruning, it will exhaust the 500MB Supabase free-tier limit.
-- This migration adds an org-aware pruning function that respects each
-- organization's configured retention_days setting (default 180).

-- 1. Create the pruning function for audit_log
CREATE OR REPLACE FUNCTION public.prune_old_audit_logs()
RETURNS VOID AS $$
DECLARE
    org_rec RECORD;
BEGIN
    FOR org_rec IN SELECT id, settings FROM public.organizations LOOP
        DELETE FROM public.audit_log
        WHERE organization_id = org_rec.id
          AND created_at < (
            NOW() - (
              COALESCE(
                (org_rec.settings->>'retention_days')::INTEGER,
                180
              ) || ' days'
            )::INTERVAL
          );
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Grant execute to authenticated role (required for Edge Function invocation)
GRANT EXECUTE ON FUNCTION public.prune_old_audit_logs() TO authenticated;

-- 3. Add an index on (organization_id, created_at) for efficient pruning
--    IF NOT EXISTS prevents failure on re-run.
CREATE INDEX IF NOT EXISTS idx_audit_log_org_created
  ON public.audit_log (organization_id, created_at);
