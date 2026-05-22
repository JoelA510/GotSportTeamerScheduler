BEGIN;

ALTER TABLE public.imports DROP CONSTRAINT IF EXISTS imports_import_type_check;
ALTER TABLE public.imports ADD CONSTRAINT imports_import_type_check
  CHECK (import_type IN ('players', 'coaches', 'fields', 'field_availability'));

ALTER TABLE public.import_jobs DROP CONSTRAINT IF EXISTS import_jobs_job_type_check;
ALTER TABLE public.import_jobs ADD CONSTRAINT import_jobs_job_type_check
  CHECK (job_type IN ('registration', 'fields', 'field_availability', 'manual'));

ALTER TABLE public.staging_import_rows DROP CONSTRAINT IF EXISTS staging_import_rows_import_type_check;
ALTER TABLE public.staging_import_rows ADD CONSTRAINT staging_import_rows_import_type_check
  CHECK (import_type IN ('coaches', 'fields', 'field_availability'));

ALTER TABLE public.import_application_records DROP CONSTRAINT IF EXISTS import_application_records_import_type_check;
ALTER TABLE public.import_application_records ADD CONSTRAINT import_application_records_import_type_check
  CHECK (import_type IN ('coaches', 'fields', 'field_availability'));

ALTER TABLE public.import_application_records DROP CONSTRAINT IF EXISTS import_application_records_target_table_check;
ALTER TABLE public.import_application_records ADD CONSTRAINT import_application_records_target_table_check
  CHECK (target_table IN (
    'coaches','fields','field_subunits','locations','practice_slots','game_slots',
    'field_availability_profiles','field_availability_profile_formats','field_blackout_windows',
    'field_equipment_requirements','field_availability_scenarios','field_availability_scenario_members'
  ));

CREATE TABLE IF NOT EXISTS public.field_availability_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  season_settings_id uuid REFERENCES public.season_settings(id) ON DELETE SET NULL,
  season_label text NOT NULL,
  field_id uuid REFERENCES public.fields(id) ON DELETE SET NULL,
  location text NOT NULL,
  field_name text NOT NULL,
  surface_type text,
  record_status text NOT NULL DEFAULT 'active' CHECK (record_status IN ('active','inactive','potential','conditional','excluded')),
  approval_status text NOT NULL DEFAULT 'approved' CHECK (approval_status IN ('approved','pending','not_approved','not_applicable')),
  available_from date NOT NULL,
  available_until date NOT NULL,
  availability_rule text,
  teams_per_hour integer CHECK (teams_per_hour IS NULL OR teams_per_hour > 0),
  aggregate_teams_per_hour integer CHECK (aggregate_teams_per_hour IS NULL OR aggregate_teams_per_hour > 0),
  capacity_basis text CHECK (capacity_basis IS NULL OR capacity_basis IN ('per_field','aggregate','mixed','unknown')),
  lighted boolean,
  restroom_potty boolean,
  goal_status text,
  use_context text,
  day_constraints text,
  move_to_location text,
  current_app_import_status text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT field_availability_profiles_date_check CHECK (available_until >= available_from)
);

CREATE TRIGGER field_availability_profiles_set_timestamp
  BEFORE UPDATE ON public.field_availability_profiles
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

CREATE TABLE IF NOT EXISTS public.field_availability_profile_formats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.field_availability_profiles(id) ON DELETE CASCADE,
  format_code text NOT NULL,
  format_quantity integer NOT NULL DEFAULT 1 CHECK (format_quantity > 0),
  format_order smallint NOT NULL DEFAULT 1 CHECK (format_order >= 1),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (profile_id, format_order)
);

CREATE TABLE IF NOT EXISTS public.field_blackout_windows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.field_availability_profiles(id) ON DELETE CASCADE,
  blackout_from date NOT NULL,
  blackout_until date NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT field_blackout_windows_date_check CHECK (blackout_until >= blackout_from)
);

CREATE TABLE IF NOT EXISTS public.field_equipment_requirements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.field_availability_profiles(id) ON DELETE CASCADE,
  goal_equipment text,
  requirement_status text CHECK (requirement_status IS NULL OR requirement_status IN ('required','recommended','blocked','not_approved','needs_purchase','available')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.field_availability_scenarios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  season_label text NOT NULL,
  name text NOT NULL,
  exclusivity_group text,
  is_active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (organization_id, season_label, name)
);

CREATE TABLE IF NOT EXISTS public.field_availability_scenario_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scenario_id uuid NOT NULL REFERENCES public.field_availability_scenarios(id) ON DELETE CASCADE,
  profile_id uuid NOT NULL REFERENCES public.field_availability_profiles(id) ON DELETE CASCADE,
  membership_status text NOT NULL DEFAULT 'included' CHECK (membership_status IN ('included','excluded','conditional')),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (scenario_id, profile_id)
);

CREATE INDEX IF NOT EXISTS idx_field_availability_profiles_org_season
  ON public.field_availability_profiles (organization_id, season_label, available_from, available_until);
CREATE INDEX IF NOT EXISTS idx_field_availability_profiles_org_field
  ON public.field_availability_profiles (organization_id, field_id);
CREATE INDEX IF NOT EXISTS idx_field_blackout_windows_profile_date
  ON public.field_blackout_windows (organization_id, profile_id, blackout_from, blackout_until);

ALTER TABLE public.field_availability_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_availability_profile_formats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_blackout_windows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_equipment_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_availability_scenarios ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.field_availability_scenario_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Field Availability Profiles: members select" ON public.field_availability_profiles
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "Field Availability Formats: members select" ON public.field_availability_profile_formats
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "Field Blackouts: members select" ON public.field_blackout_windows
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "Field Equipment Requirements: members select" ON public.field_equipment_requirements
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "Field Availability Scenarios: members select" ON public.field_availability_scenarios
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));
CREATE POLICY "Field Availability Scenario Members: members select" ON public.field_availability_scenario_members
  FOR SELECT TO authenticated USING (public.is_org_member(organization_id));

CREATE OR REPLACE FUNCTION public.finalize_field_availability_import_job(
  p_import_job_id uuid,
  p_validation_errors jsonb DEFAULT '[]'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.import_jobs%ROWTYPE;
  v_row public.staging_import_rows%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
  v_payload jsonb;
  v_profile_id uuid;
  v_field_id uuid;
  v_inserted_profiles integer := 0;
  v_inserted_blackouts integer := 0;
  v_inserted_requirements integer := 0;
  v_inserted_formats integer := 0;
  v_inserted_scenarios integer := 0;
  v_inserted_members integer := 0;
  v_invalid_rows integer := 0;
  v_location text;
  v_field_name text;
  v_avail_from date;
  v_avail_until date;
  v_primary_format text;
  v_secondary_format text;
  v_format_qty integer;
  v_record_status text;
  v_approval_status text;
  v_goal_equipment text;
  v_goal_status text;
  v_blackout_months text;
  v_scenario_name text;
  v_scenario_id uuid;
BEGIN
  IF jsonb_typeof(COALESCE(p_validation_errors, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_validation_errors must be a jsonb array' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_job FROM public.import_jobs WHERE id = p_import_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import job % not found', p_import_job_id USING ERRCODE = 'P0002'; END IF;
  IF NOT public.is_org_admin(v_job.organization_id) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;
  IF v_job.job_type <> 'field_availability' THEN RAISE EXCEPTION 'Import job % is %, not field_availability', p_import_job_id, v_job.job_type USING ERRCODE='22023'; END IF;

  FOR v_row IN
    SELECT * FROM public.staging_import_rows
    WHERE import_job_id = p_import_job_id
      AND organization_id = v_job.organization_id
      AND import_type = 'field_availability'
      AND applied_at IS NULL
      AND normalized_payload IS NOT NULL
    ORDER BY source_row_number NULLS LAST, id
  LOOP
    v_payload := v_row.normalized_payload;
    v_location := public.import_payload_text(v_payload, 'location');
    v_field_name := public.import_payload_text(v_payload, 'field_name', 'name');
    v_avail_from := public.import_text_to_date(public.import_payload_text(v_payload, 'available_from'));
    v_avail_until := public.import_text_to_date(public.import_payload_text(v_payload, 'available_until'));

    IF v_location IS NULL OR v_field_name IS NULL OR v_avail_from IS NULL OR v_avail_until IS NULL OR v_avail_until < v_avail_from THEN
      v_invalid_rows := v_invalid_rows + 1;
      UPDATE public.staging_import_rows
      SET validation_errors = jsonb_build_array(jsonb_build_object('message','Availability row missing required location/field/date range','source_row_number',v_row.source_row_number))
      WHERE id = v_row.id;
      CONTINUE;
    END IF;

    SELECT f.id INTO v_field_id
    FROM public.fields f JOIN public.locations l ON l.id = f.location_id
    WHERE f.organization_id = v_job.organization_id
      AND lower(l.name) = lower(v_location)
      AND lower(f.name) = lower(v_field_name)
    ORDER BY f.created_at, f.id LIMIT 1;

    v_record_status := lower(COALESCE(public.import_payload_text(v_payload, 'record_status'),'active'));
    v_approval_status := lower(COALESCE(public.import_payload_text(v_payload, 'approval_status'),'approved'));

    INSERT INTO public.field_availability_profiles (
      organization_id, season_label, season_settings_id, field_id, location, field_name, surface_type,
      record_status, approval_status, available_from, available_until, availability_rule,
      teams_per_hour, aggregate_teams_per_hour, capacity_basis, lighted, restroom_potty,
      goal_status, use_context, day_constraints, move_to_location, current_app_import_status, notes
    ) VALUES (
      v_job.organization_id,
      COALESCE(public.import_payload_text(v_payload, 'season_label'), 'Unspecified Season'),
      NULL,
      v_field_id,
      v_location,
      v_field_name,
      public.import_payload_text(v_payload, 'surface_type'),
      CASE WHEN v_record_status IN ('active','inactive','potential','conditional','excluded') THEN v_record_status ELSE 'active' END,
      CASE WHEN v_approval_status IN ('approved','pending','not_approved','not_applicable') THEN v_approval_status ELSE 'approved' END,
      v_avail_from,
      v_avail_until,
      public.import_payload_text(v_payload, 'availability_rule'),
      public.import_text_to_positive_int(public.import_payload_text(v_payload, 'teams_per_hour'), NULL),
      public.import_text_to_positive_int(public.import_payload_text(v_payload, 'aggregate_teams_per_hour'), NULL),
      lower(public.import_payload_text(v_payload, 'capacity_basis')),
      CASE WHEN public.import_payload_text(v_payload, 'lighted') IS NULL THEN NULL ELSE public.import_text_to_bool(public.import_payload_text(v_payload, 'lighted')) END,
      CASE WHEN public.import_payload_text(v_payload, 'restroom_potty') IS NULL THEN NULL ELSE public.import_text_to_bool(public.import_payload_text(v_payload, 'restroom_potty')) END,
      public.import_payload_text(v_payload, 'goal_status'),
      public.import_payload_text(v_payload, 'use_context'),
      public.import_payload_text(v_payload, 'day_constraints'),
      public.import_payload_text(v_payload, 'move_to_location'),
      public.import_payload_text(v_payload, 'current_app_import_status'),
      public.import_payload_text(v_payload, 'notes')
    ) RETURNING id INTO v_profile_id;

    v_inserted_profiles := v_inserted_profiles + 1;

    v_primary_format := public.import_payload_text(v_payload, 'primary_format');
    v_secondary_format := public.import_payload_text(v_payload, 'secondary_format');
    v_format_qty := COALESCE(public.import_text_to_positive_int(public.import_payload_text(v_payload, 'format_quantity'), 1), 1);

    IF v_primary_format IS NOT NULL THEN
      INSERT INTO public.field_availability_profile_formats (organization_id, profile_id, format_code, format_quantity, format_order)
      VALUES (v_job.organization_id, v_profile_id, v_primary_format, v_format_qty, 1);
      v_inserted_formats := v_inserted_formats + 1;
    END IF;
    IF v_secondary_format IS NOT NULL THEN
      INSERT INTO public.field_availability_profile_formats (organization_id, profile_id, format_code, format_quantity, format_order)
      VALUES (v_job.organization_id, v_profile_id, v_secondary_format, v_format_qty, 2);
      v_inserted_formats := v_inserted_formats + 1;
    END IF;

    v_goal_equipment := public.import_payload_text(v_payload, 'goal_equipment');
    v_goal_status := public.import_payload_text(v_payload, 'goal_status');
    IF v_goal_equipment IS NOT NULL OR v_goal_status IS NOT NULL THEN
      INSERT INTO public.field_equipment_requirements (organization_id, profile_id, goal_equipment, requirement_status, notes)
      VALUES (v_job.organization_id, v_profile_id, v_goal_equipment, lower(v_goal_status), NULL);
      v_inserted_requirements := v_inserted_requirements + 1;
    END IF;

    v_blackout_months := lower(COALESCE(public.import_payload_text(v_payload, 'blackout_months'), ''));
    IF v_blackout_months <> '' THEN
      IF position('aug' in v_blackout_months) > 0 THEN
        INSERT INTO public.field_blackout_windows (organization_id, profile_id, blackout_from, blackout_until, reason)
        VALUES (v_job.organization_id, v_profile_id, '2026-08-01', '2026-08-31', 'blackout_months');
        v_inserted_blackouts := v_inserted_blackouts + 1;
      END IF;
      IF position('sep' in v_blackout_months) > 0 THEN
        INSERT INTO public.field_blackout_windows (organization_id, profile_id, blackout_from, blackout_until, reason)
        VALUES (v_job.organization_id, v_profile_id, '2026-09-01', '2026-09-30', 'blackout_months');
        v_inserted_blackouts := v_inserted_blackouts + 1;
      END IF;
      IF position('oct' in v_blackout_months) > 0 THEN
        INSERT INTO public.field_blackout_windows (organization_id, profile_id, blackout_from, blackout_until, reason)
        VALUES (v_job.organization_id, v_profile_id, '2026-10-01', '2026-10-31', 'blackout_months');
        v_inserted_blackouts := v_inserted_blackouts + 1;
      END IF;
      IF position('nov' in v_blackout_months) > 0 THEN
        INSERT INTO public.field_blackout_windows (organization_id, profile_id, blackout_from, blackout_until, reason)
        VALUES (v_job.organization_id, v_profile_id, '2026-11-01', '2026-11-30', 'blackout_months');
        v_inserted_blackouts := v_inserted_blackouts + 1;
      END IF;
    END IF;

    v_scenario_name := public.import_payload_text(v_payload, 'scenario_name');
    IF v_scenario_name IS NOT NULL THEN
      INSERT INTO public.field_availability_scenarios (organization_id, season_label, name, exclusivity_group)
      VALUES (v_job.organization_id, COALESCE(public.import_payload_text(v_payload,'season_label'),'Unspecified Season'), v_scenario_name, public.import_payload_text(v_payload, 'scenario_group'))
      ON CONFLICT (organization_id, season_label, name) DO UPDATE SET exclusivity_group = EXCLUDED.exclusivity_group
      RETURNING id INTO v_scenario_id;
      IF v_scenario_id IS NULL THEN
        SELECT id INTO v_scenario_id FROM public.field_availability_scenarios
        WHERE organization_id = v_job.organization_id
          AND season_label = COALESCE(public.import_payload_text(v_payload,'season_label'),'Unspecified Season')
          AND name = v_scenario_name
        LIMIT 1;
      END IF;
      INSERT INTO public.field_availability_scenario_members (organization_id, scenario_id, profile_id, membership_status)
      VALUES (v_job.organization_id, v_scenario_id, v_profile_id, 'included')
      ON CONFLICT (scenario_id, profile_id) DO NOTHING;
      v_inserted_members := v_inserted_members + 1;
      v_inserted_scenarios := v_inserted_scenarios + 1;
    END IF;

    INSERT INTO public.import_application_records (organization_id, import_job_id, import_type, target_table, target_id, operation, previous_payload, applied_payload, applied_at, applied_by)
    VALUES
      (v_job.organization_id, p_import_job_id, 'field_availability', 'field_availability_profiles', v_profile_id, 'inserted', NULL, to_jsonb((SELECT p FROM public.field_availability_profiles p WHERE p.id=v_profile_id)), v_now, auth.uid())
    ON CONFLICT (import_job_id, target_table, target_id) DO NOTHING;

    UPDATE public.staging_import_rows SET applied_at=v_now, applied_by=auth.uid() WHERE id=v_row.id;
  END LOOP;

  UPDATE public.import_jobs
  SET status = CASE WHEN v_invalid_rows > 0 OR jsonb_array_length(COALESCE(p_validation_errors,'[]'::jsonb)) > 0 THEN 'completed_with_warnings' ELSE 'completed' END,
      processed_rows = COALESCE(processed_rows,0) + v_inserted_profiles,
      progress_percent = 100,
      completed_at = v_now,
      error_summary = jsonb_build_object('rowErrors', COALESCE(p_validation_errors,'[]'::jsonb)),
      warning_summary = jsonb_build_object('availability_finalize', jsonb_build_object('invalid_rows', v_invalid_rows))
  WHERE id = p_import_job_id;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_invalid_rows > 0 OR jsonb_array_length(COALESCE(p_validation_errors,'[]'::jsonb)) > 0 THEN 'completed_with_warnings' ELSE 'completed' END,
    'inserted_profiles', v_inserted_profiles,
    'inserted_formats', v_inserted_formats,
    'inserted_blackouts', v_inserted_blackouts,
    'inserted_requirements', v_inserted_requirements,
    'inserted_scenarios', v_inserted_scenarios,
    'inserted_scenario_members', v_inserted_members,
    'invalid_rows', v_invalid_rows
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.rollback_field_availability_import_job(p_import_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_job public.import_jobs%ROWTYPE;
  v_record public.import_application_records%ROWTYPE;
  v_now timestamptz := timezone('utc', now());
  v_deleted_profiles integer := 0;
BEGIN
  SELECT * INTO v_job FROM public.import_jobs WHERE id = p_import_job_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Import job % not found', p_import_job_id USING ERRCODE='P0002'; END IF;
  IF NOT public.is_org_admin(v_job.organization_id) THEN RAISE EXCEPTION 'Access denied' USING ERRCODE='42501'; END IF;

  FOR v_record IN
    SELECT * FROM public.import_application_records
    WHERE import_job_id = p_import_job_id AND import_type = 'field_availability' AND rolled_back_at IS NULL
    ORDER BY created_at DESC
  LOOP
    IF v_record.target_table = 'field_availability_profiles' AND v_record.operation = 'inserted' THEN
      DELETE FROM public.field_availability_profiles
      WHERE id = v_record.target_id AND organization_id = v_job.organization_id;
      v_deleted_profiles := v_deleted_profiles + 1;
    END IF;

    UPDATE public.import_application_records
    SET rolled_back_at = v_now, rolled_back_by = auth.uid(), rollback_payload = jsonb_build_object('rolled_back', true)
    WHERE id = v_record.id;
  END LOOP;

  UPDATE public.import_jobs
  SET status = 'needs_fix', warning_summary = jsonb_set(COALESCE(warning_summary,'{}'::jsonb), '{availability_rollback}', jsonb_build_object('deleted_profiles', v_deleted_profiles), true)
  WHERE id = p_import_job_id;

  RETURN jsonb_build_object('status', 'rolled_back', 'deleted_profiles', v_deleted_profiles);
END;
$$;

REVOKE ALL ON FUNCTION public.finalize_field_availability_import_job(uuid, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rollback_field_availability_import_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finalize_field_availability_import_job(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_field_availability_import_job(uuid) TO authenticated;

COMMIT;
