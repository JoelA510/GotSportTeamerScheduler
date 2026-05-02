-- Migration: 20260404120000_phase_4_observability.sql
-- Description: Enhancements for Real-time Ingestion Observability and Overlays.

-- 1. Add progress_percent and efficiency_metadata to import_jobs
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_jobs' AND column_name='progress_percent') THEN
        ALTER TABLE public.import_jobs ADD COLUMN progress_percent integer DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100);
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='import_jobs' AND column_name='efficiency_metadata') THEN
        ALTER TABLE public.import_jobs ADD COLUMN efficiency_metadata jsonb DEFAULT '{}'::jsonb;
    END IF;
END $$;

-- 2. Update status check constraint to include 'importing' if needed, 
-- but 'processing' is already there. Let's add 'importing' as a synonym or replacement if the user prefers.
-- The directive mentioned 'importing' state for re-hydration.
ALTER TABLE public.import_jobs DROP CONSTRAINT IF EXISTS import_jobs_status_check;
ALTER TABLE public.import_jobs ADD CONSTRAINT import_jobs_status_check 
    CHECK (status IN ('queued', 'processing', 'importing', 'completed', 'completed_with_warnings', 'needs_fix', 'failed'));

-- 3. Enable Realtime for import_jobs
-- Note: This requires the publication 'supabase_realtime' to exist.
-- If it doesn't, we create it.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
        CREATE PUBLICATION supabase_realtime;
    END IF;
    
    -- Add the table to the publication
    ALTER PUBLICATION supabase_realtime ADD TABLE public.import_jobs;
EXCEPTION
    WHEN duplicate_object THEN
        NULL; -- Table already in publication
END $$;

-- 4. RLS for Realtime (Ensure authenticated users can see their org's jobs)
-- Policies are already enabled on import_jobs, but let's ensure they are robust.
DROP POLICY IF EXISTS "Users can view their organization's import jobs" ON public.import_jobs;
CREATE POLICY "Users can view their organization's import jobs"
    ON public.import_jobs FOR SELECT
    USING (
        organization_id IN (
            SELECT organization_id FROM public.organization_members 
            WHERE profile_id = auth.uid()
        )
    );

-- 5. Efficiency Metric View (Optional Helper)
-- Derived from telemetry_log for the "Smart Match Rate"
CREATE OR REPLACE VIEW public.import_efficiency_metrics AS
WITH import_events AS (
    SELECT
        CASE
            WHEN payload->>'import_job_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                THEN (payload->>'import_job_id')::uuid
        END AS import_job_id,
        event_type
    FROM public.telemetry_log
)
SELECT
    import_job_id,
    COUNT(*) FILTER (WHERE event_type = 'import.suggestion_applied') as suggestions_applied,
    COUNT(*) FILTER (WHERE event_type = 'import.suggestion_received') as total_suggestions,
    CASE 
        WHEN COUNT(*) FILTER (WHERE event_type = 'import.suggestion_received') > 0 
        THEN (COUNT(*) FILTER (WHERE event_type = 'import.suggestion_applied')::float / COUNT(*) FILTER (WHERE event_type = 'import.suggestion_received')::float) * 100
        ELSE 100
    END as match_rate
FROM import_events
WHERE import_job_id IS NOT NULL
GROUP BY import_job_id;

-- Ensure RLS on the view if needed (PostgreSQL views don't have RLS, but the underlying tables do)
-- GRANT SELECT ON public.import_efficiency_metrics TO authenticated;
