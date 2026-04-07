-- Migration: Enable Realtime for audit_log
-- Created: 2026-04-08
-- Description: Adds audit_log to the supabase_realtime publication so the
--   Auto-Scheduler UI can subscribe to live progress events via
--   Supabase Realtime channels.
--
-- NOTE: If the supabase_realtime publication does not exist yet (e.g. fresh
-- local dev), the first statement creates it. On hosted Supabase the
-- publication already exists, so CREATE IF NOT EXISTS is safe.

DO $$
BEGIN
  -- Ensure the publication exists (no-op on hosted Supabase)
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;

  -- Add audit_log to the publication (idempotent: skip if already a member)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'audit_log'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.audit_log;
  END IF;
END$$;

COMMENT ON TABLE public.audit_log IS
  'Immutable audit trail. Added to supabase_realtime publication in Phase 8 '
  'to enable live progress tracking for the Auto-Scheduler UI.';
