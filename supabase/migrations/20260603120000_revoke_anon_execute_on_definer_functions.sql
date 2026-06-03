-- Revoke anon (and PUBLIC) EXECUTE on SECURITY DEFINER functions in `public`.
--
-- Context: the Supabase security advisor flags every SECURITY DEFINER function
-- the `anon` / `authenticated` roles can execute
-- (`anon_security_definer_function_executable` /
-- `authenticated_security_definer_function_executable`). New functions inherit
-- EXECUTE both from PostgreSQL's default PUBLIC grant and from Supabase's
-- default privileges (anon/authenticated/service_role), so admin RPCs that are
-- gated only by an internal `is_org_admin()` check remain directly invokable by
-- unauthenticated callers. This migration removes that unnecessary surface.
--
-- Policy applied:
--   * Trigger functions (return type `trigger`) are invoked by the trigger
--     machinery as the table owner; no client role needs a direct EXECUTE grant.
--     -> revoke from PUBLIC, anon, AND authenticated.
--   * Admin RPCs, RLS helpers (`is_org_admin` / `is_org_member`) and internal
--     helpers (`record_audit_event`) are called by logged-in admins via PostgREST
--     and/or referenced by RLS policies scoped to `authenticated`.
--     -> revoke from PUBLIC + anon; KEEP authenticated.
--   * `service_role` is never revoked: server-side / Edge Function paths that use
--     the service-role key keep working for every function.
--
-- Deliberately EXCLUDED (anon EXECUTE intentionally retained):
--   * public.submit_registration(...) — reached from the PUBLIC, unauthenticated
--     `/register/:formId` route (youth-sports registration forms are shared as
--     public links). Revoking anon here would break public registration.
--
-- Why this is safe (verified against the live project mmwupqsjkikqzvmdvuzm):
--   * `is_org_member` is referenced by 47 RLS policies and `is_org_admin` by 18,
--     ALL scoped to the `authenticated` role only — authenticated must keep
--     EXECUTE (preserved here) and anon never evaluates them via RLS.
--   * The only anon-reachable routes (/register, /invite, /organizations/new)
--     call solely submit_registration (excluded) and redeem_org_invite (the
--     invite flow redirects anon to Login before redeeming, and the function
--     requires auth.uid()), so no working anon flow loses access.
--   * No behavior change for authenticated users: their explicit EXECUTE grants
--     on every non-trigger function are left intact.
--   * A transactional dry-run of these exact statements against the live schema
--     applied cleanly (all 48 signatures valid) and produced the intended grant
--     state before being rolled back.
--
-- Reversible: see docs/sql/20260603120000_revert.sql.
-- Smoke checks: see docs/sql/20260603120000_smoke.sql.

BEGIN;

-- Tier 1 — trigger functions: no client role needs a direct EXECUTE grant.
REVOKE EXECUTE ON FUNCTION
  public.check_password_length_on_auth_users(),
  public.handle_field_subunits(),
  public.handle_new_user(),
  public.log_schema_change(),
  public.propagate_org_id_from_evaluation_run(),
  public.propagate_org_id_from_export_job(),
  public.propagate_org_id_from_field(),
  public.propagate_org_id_from_home_team(),
  public.propagate_org_id_from_import_job(),
  public.propagate_org_id_from_player(),
  public.propagate_org_id_from_scheduler_run(),
  public.propagate_org_id_from_season_settings(),
  public.propagate_org_id_from_team()
FROM PUBLIC, anon, authenticated;

-- Tier 2 — admin RPCs + RLS/internal helpers: drop anon (+PUBLIC); keep authenticated.
REVOKE EXECUTE ON FUNCTION
  public.admin_select_field_availability_scenario(uuid, text, text, uuid),
  public.cancel_ready_import_job(uuid, text),
  public.create_import_job(uuid, text, text),
  public.create_org_invite(uuid, text, interval),
  public.fail_import_job(uuid, text, jsonb),
  public.fail_stale_import_jobs(uuid, timestamp with time zone),
  public.finalize_coach_import_job(uuid, jsonb),
  public.finalize_field_availability_import_job(uuid, jsonb),
  public.finalize_field_import_job(uuid, jsonb),
  public.finalize_import_job(uuid, jsonb),
  public.finalize_onboarding(uuid, jsonb),
  public.get_field_availability_scenarios(uuid, text),
  public.get_settings_audit_log(uuid),
  public.initialize_new_tenant(text, text, text, integer),
  public.is_org_admin(uuid),
  public.is_org_member(uuid),
  public.log_telemetry_event(uuid, text, jsonb),
  public.mark_import_job_ready_to_apply(uuid, text, jsonb),
  public.materialize_import_buddy_pairs(uuid),
  public.persist_evaluation_run(jsonb, jsonb, jsonb),
  public.persist_evaluation_run(uuid, text, jsonb, integer),
  public.persist_evaluation_run(jsonb, jsonb[], jsonb[]),
  public.prune_old_audit_logs(),
  public.prune_old_evaluation_runs(),
  public.record_audit_event(uuid, text, text, uuid, jsonb, inet),
  public.redeem_org_invite(text),
  public.rollback_coach_import_job(uuid),
  public.rollback_field_availability_import_job(uuid),
  public.rollback_field_import_job(uuid),
  public.rotate_calendar_token(uuid),
  public.set_import_job_coach_lead_summary(uuid, jsonb, text),
  public.update_import_job_progress(uuid, integer, integer, integer, jsonb),
  public.update_org_feature_flags(uuid, jsonb),
  public.upsert_coach_leads(jsonb),
  public.upsert_division_for_import(uuid, uuid, text, text, integer, integer, date, date)
FROM PUBLIC, anon;

COMMIT;
