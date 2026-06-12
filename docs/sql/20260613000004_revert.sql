-- Revert for 20260613000004_team_update_rpc.sql
DROP FUNCTION IF EXISTS public.admin_update_team(uuid, jsonb);

-- Remove 'team.updated' from the audit constraint by re-running the full
-- constraint block from 20260613000003.
