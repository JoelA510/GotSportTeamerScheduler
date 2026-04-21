-- Revert script for migration 20260421002500_lock_search_path_remaining_definers.sql
-- USE WITH CAUTION: re-opens search-path injection vector + telemetry leak on coach_team_map.

ALTER FUNCTION public.is_org_admin(UUID) RESET search_path;
ALTER FUNCTION public.is_org_member(UUID) RESET search_path;
ALTER FUNCTION public.handle_field_subunits() RESET search_path;
ALTER FUNCTION public.prune_old_audit_logs() RESET search_path;
ALTER VIEW public.coach_team_map SET (security_invoker = off);
