-- 20260416000002_data_retention_cron.sql
-- Enables pg_cron extension, configures automated cleanup for staging tables, exports, and audit logs.
BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

-- Clear older export jobs automatically at 2:00 AM everyday
SELECT cron.schedule(
    'cleanup-export-jobs',
    '0 2 * * *',
    $$ DELETE FROM public.export_jobs WHERE created_at < now() - interval '7 days' $$
);

-- Clear stale staging players automatically at 3:00 AM everyday
SELECT cron.schedule(
    'cleanup-staging-players',
    '0 3 * * *',
    $$ DELETE FROM public.staging_players WHERE created_at < now() - interval '30 days' $$
);

-- Prune audit logs automatically at 4:00 AM everyday
SELECT cron.schedule(
    'cleanup-audit-log',
    '0 4 * * *',
    $$ DELETE FROM public.audit_log WHERE created_at < now() - interval '180 days' $$
);

COMMIT;
