-- Revert for 20260613000000_coach_delete_rpc.sql
DROP FUNCTION IF EXISTS public.admin_delete_coaches(uuid[]);

-- Restore the previous audit_log action whitelist (without 'coach.deleted');
-- re-run the constraint block from 20260611000300_redesign_audit_actions.sql.
