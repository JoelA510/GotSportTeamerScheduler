-- Wave 6a Task 2 follow-up: pin search_path on the remaining 4 SECURITY DEFINER
-- functions that the new advisor-lint script flagged but Supabase Advisor's live
-- check did not (likely because they're trigger or admin-only callers, not on
-- the public-callable risk surface). Closing them now anyway as defense-in-depth.
--
-- Also flips coach_team_map view to security_invoker = on for symmetry with
-- import_efficiency_metrics (Wave 2 Task 1).
--
-- Functions covered:
--   1. is_org_admin(UUID)         [core_auth migration]
--   2. is_org_member(UUID)        [strict_rls_multi_tenancy migration]
--   3. handle_field_subunits()    [facility_multi_tenancy trigger]
--   4. prune_old_audit_logs()     [audit_log_retention_180 RPC]
--
-- View covered:
--   coach_team_map                [consolidated_schema migration]

ALTER FUNCTION public.is_org_admin(UUID)
  SET search_path = public;

ALTER FUNCTION public.is_org_member(UUID)
  SET search_path = public;

ALTER FUNCTION public.handle_field_subunits()
  SET search_path = public;

ALTER FUNCTION public.prune_old_audit_logs()
  SET search_path = public;

ALTER VIEW public.coach_team_map
  SET (security_invoker = on);
