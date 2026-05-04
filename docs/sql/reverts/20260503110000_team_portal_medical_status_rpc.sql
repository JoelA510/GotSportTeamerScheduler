-- Revert 20260503110000_team_portal_medical_status_rpc.sql.
--
-- This removes the read-side Team Portal medical status RPC. Pair this with an
-- app rollback to a version that does not call
-- public.get_team_portal_medical_status(uuid).

BEGIN;

DROP FUNCTION IF EXISTS public.get_team_portal_medical_status(uuid);

COMMIT;
