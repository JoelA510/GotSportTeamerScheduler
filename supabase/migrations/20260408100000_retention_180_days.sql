-- Migration: Reduce default evaluation_runs retention from 365 to 180 days
-- Created: 2026-04-08
-- Reason: Auto-Scheduler progress events (scheduler.auto_progress) in the
--   audit_log can be noisy. Halving retention keeps the table manageable
--   while preserving enough history for compliance and trend analysis.

-- 1. Update the column default for new organizations
ALTER TABLE public.organizations
  ALTER COLUMN settings SET DEFAULT '{ "retention_days": 180 }'::jsonb;

-- 2. Migrate existing orgs that still have the old 365-day default
--    (orgs with a custom value are left untouched)
UPDATE public.organizations
SET settings = jsonb_set(settings, '{retention_days}', '180')
WHERE (settings->>'retention_days')::INTEGER = 365;

-- 3. Update the pruning function fallback from 365 → 180
CREATE OR REPLACE FUNCTION public.prune_old_evaluation_runs()
RETURNS VOID AS $$
DECLARE
    org_rec RECORD;
BEGIN
    FOR org_rec IN SELECT id, settings FROM public.organizations LOOP
        DELETE FROM public.evaluation_runs
        WHERE organization_id = org_rec.id
          AND created_at < (NOW() - (COALESCE((org_rec.settings->>'retention_days')::INTEGER, 180) || ' days')::INTERVAL);
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
