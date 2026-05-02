-- Smoke test for 20260502000000_import_finalize_pipeline.sql.
-- Run after migrations in a disposable/local Supabase database.

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'staging_players'
          AND column_name = 'promoted_at'
    ) THEN
        RAISE EXCEPTION 'staging_players.promoted_at is missing';
    END IF;

    IF to_regprocedure('public.finalize_import_job(uuid,jsonb)') IS NULL THEN
        RAISE EXCEPTION 'finalize_import_job(uuid,jsonb) is missing';
    END IF;
END;
$$;

ROLLBACK;
