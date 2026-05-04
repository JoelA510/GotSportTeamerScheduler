-- Emergency rollback for 20260504010000_update_game_score_rpc.sql.
--
-- This removes the league standings score update RPC. Pair with an application
-- rollback that removes calls to public.update_game_score(uuid, uuid, smallint,
-- smallint, jsonb).
--
-- The migration also allowed the competition.score_updated audit action. This
-- rollback leaves that action value allowed so historical audit rows remain
-- valid and the rollback does not delete audit evidence.

\set ON_ERROR_STOP on

BEGIN;

DROP FUNCTION IF EXISTS public.update_game_score(uuid, uuid, smallint, smallint, jsonb);

COMMIT;
