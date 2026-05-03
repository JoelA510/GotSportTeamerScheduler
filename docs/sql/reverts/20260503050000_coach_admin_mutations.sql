-- Emergency rollback for 20260503050000_coach_admin_mutations.sql.
--
-- This removes the admin coach mutation RPC surface. Pair with an
-- application rollback that removes the /coaches mutation controls.
--
-- The migration also allowed new audit action values. This rollback leaves
-- those action values allowed so historical audit rows remain queryable and
-- the rollback does not delete audit evidence.

\set ON_ERROR_STOP on

BEGIN;

DROP FUNCTION IF EXISTS public.admin_assign_team_coach(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_update_coach_status(uuid, uuid, text);

COMMIT;
