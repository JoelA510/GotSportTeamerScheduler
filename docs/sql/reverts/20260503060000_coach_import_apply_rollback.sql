-- Emergency rollback for 20260503060000_coach_import_apply_rollback.sql.
--
-- Use only with the paired application rollback. Dropping the staging and
-- application ledger tables removes coach-import apply/rollback evidence for
-- in-flight jobs, so prefer reverting before operators use coach CSV apply in
-- production.

BEGIN;

DROP FUNCTION IF EXISTS public.rollback_coach_import_job(uuid);
DROP FUNCTION IF EXISTS public.finalize_coach_import_job(uuid, jsonb);
DROP FUNCTION IF EXISTS public.import_text_to_jsonb_array(text);

DROP TABLE IF EXISTS public.import_application_records;
DROP TABLE IF EXISTS public.staging_import_rows;

-- Intentionally do not remove audit_log action value import.rolled_back here.
-- Existing audit rows must remain queryable after an emergency app rollback.

COMMIT;
