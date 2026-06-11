-- Hotfix: core Postgres has no min(uuid) aggregate, but three RPCs use
-- min(organization_id) on uuid columns to pick the single org out of a
-- validated-single-org set:
--
--   * admin_bulk_update_players / admin_delete_players
--     (20260611000100_player_admin_mutation_rpcs.sql)
--   * persist_team_schedule's candidate-org fallback
--     (20260610000000_teaming_rerun_followups.sql)
--
-- CREATE FUNCTION doesn't validate plpgsql expression types, so the bug
-- only surfaced at runtime: every Players-grid delete/bulk-update failed
-- with 42883 "function min(uuid) does not exist" (surfaced by PostgREST
-- as a 404 on the RPC endpoint). Defining the aggregate fixes all call
-- sites without redefining the functions; uuid already has a btree
-- ordering, so min() is well-defined.

CREATE OR REPLACE FUNCTION public.min_uuid(uuid, uuid)
RETURNS uuid
LANGUAGE sql
IMMUTABLE PARALLEL SAFE
SET search_path = public
AS $$ SELECT LEAST($1, $2); $$;

REVOKE EXECUTE ON FUNCTION public.min_uuid(uuid, uuid) FROM PUBLIC, anon;

DROP AGGREGATE IF EXISTS public.min(uuid);
CREATE AGGREGATE public.min(uuid) (
    SFUNC = public.min_uuid,
    STYPE = uuid,
    COMBINEFUNC = public.min_uuid,
    PARALLEL = SAFE,
    SORTOP = OPERATOR(<)
);
