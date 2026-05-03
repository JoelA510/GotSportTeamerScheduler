-- Emergency rollback for 20260503040000_repair_team_persistence_rpc.sql.
--
-- This removes the repaired team persistence contract. The prior
-- persist_team_schedule function used the old bigint/organization-less
-- scheduler schema, so pair this rollback with an application rollback or a
-- replacement compatible RPC before re-enabling team apply.

\set ON_ERROR_STOP on

BEGIN;

DROP FUNCTION IF EXISTS public.persist_team_schedule(jsonb, jsonb, jsonb);

COMMIT;
