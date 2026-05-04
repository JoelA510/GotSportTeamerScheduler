-- Emergency rollback for 20260504080000_import_job_lifecycle_rpcs.sql.
--
-- Use only with an application rollback that restores the previous direct
-- import_jobs write path. This rollback intentionally restores the broad
-- member-write policy that existed before the RPC hardening PR.

BEGIN;

DROP FUNCTION IF EXISTS public.fail_import_job(uuid, text, jsonb);
DROP FUNCTION IF EXISTS public.update_import_job_progress(uuid, integer, integer, integer, jsonb);
DROP FUNCTION IF EXISTS public.create_import_job(uuid, text, text);

DROP POLICY IF EXISTS "Strict org access on import_jobs" ON public.import_jobs;
CREATE POLICY "Strict org access on import_jobs"
  ON public.import_jobs FOR ALL TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

COMMIT;
