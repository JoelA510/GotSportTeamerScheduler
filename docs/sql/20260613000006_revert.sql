-- Revert for 20260613000006_audit_actions_lookup.sql
--
-- Restores the CHECK-constraint enforcement and removes the lookup table.
-- The constraint body below is the final whitelist state from
-- 20260613000004_team_update_rpc.sql; if reverting after later actions were
-- registered, add them to the list first (SELECT action FROM audit_actions).

ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_fkey;

-- Re-run the audit_log_action_check block from
-- supabase/migrations/20260613000004_team_update_rpc.sql here.

DROP TABLE IF EXISTS public.audit_actions;
