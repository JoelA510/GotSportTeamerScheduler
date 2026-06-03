-- Revert for 20260603120000_revoke_anon_execute_on_definer_functions.sql
--
-- Restores the pre-migration EXECUTE grants: re-grants PUBLIC + anon on every
-- listed function, plus authenticated on the trigger functions. This re-opens
-- the surface the forward migration closed, so only run it to roll the hardening
-- back. `service_role` and the function owner are unaffected (never revoked).

BEGIN;

-- Tier 1 — trigger functions: restore PUBLIC, anon, authenticated.
GRANT EXECUTE ON FUNCTION
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
TO PUBLIC, anon, authenticated;

-- Tier 2 — restore PUBLIC + anon (authenticated was never revoked).
GRANT EXECUTE ON FUNCTION
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
TO PUBLIC, anon;

COMMIT;
