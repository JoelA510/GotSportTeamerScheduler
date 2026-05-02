-- Revert for 20260502000000_import_finalize_pipeline.sql.
--
-- This removes the finalize RPC and helper functions only. It intentionally
-- leaves staged rows and promoted player rows intact so rollback never deletes
-- imported registration data. If a bad import was finalized, revert the narrow
-- application PR first, then use audit/import_job metadata to correct player
-- rows with a forward-safe data migration.

BEGIN;

DROP FUNCTION IF EXISTS public.finalize_import_job(uuid, jsonb);
DROP FUNCTION IF EXISTS public.import_text_to_bool(text);
DROP FUNCTION IF EXISTS public.import_text_to_date(text);
DROP FUNCTION IF EXISTS public.import_payload_text(jsonb, text[]);

DROP INDEX IF EXISTS public.idx_players_org_external_registration_id;
DROP INDEX IF EXISTS public.staging_players_import_job_source_row_key;
DROP INDEX IF EXISTS public.idx_staging_players_org_job_source;

ALTER TABLE public.staging_players
    DROP COLUMN IF EXISTS promoted_by,
    DROP COLUMN IF EXISTS promoted_at,
    DROP COLUMN IF EXISTS source_row_number;

COMMIT;
