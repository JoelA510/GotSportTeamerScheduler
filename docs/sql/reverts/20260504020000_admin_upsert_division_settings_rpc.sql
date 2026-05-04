-- Emergency rollback for 20260504020000_admin_upsert_division_settings_rpc.sql.
--
-- This removes the division settings mutation RPC. Pair with an application
-- rollback that removes calls to public.admin_upsert_division_settings(...).
--
-- The RPC only changes rows in public.divisions and writes settings.updated
-- audit rows. This rollback does not delete division settings or audit evidence.

\set ON_ERROR_STOP on

BEGIN;

DROP FUNCTION IF EXISTS public.admin_upsert_division_settings(
    uuid,
    uuid,
    uuid,
    text,
    integer,
    integer,
    integer,
    integer,
    integer,
    integer
);

COMMIT;
