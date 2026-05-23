BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS uq_field_availability_one_active_per_group
ON public.field_availability_scenarios (organization_id, season_label, exclusivity_group)
WHERE is_active AND exclusivity_group IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_field_availability_scenarios(
  p_organization_id uuid,
  p_season_label text
)
RETURNS TABLE (
  scenario_id uuid,
  organization_id uuid,
  season_label text,
  name text,
  exclusivity_group text,
  is_active boolean,
  member_count bigint,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL OR p_season_label IS NULL OR btrim(p_season_label) = '' THEN
    RAISE EXCEPTION 'organization_id and season_label are required' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT s.id, s.organization_id, s.season_label, s.name, s.exclusivity_group, s.is_active,
         COUNT(m.id) AS member_count, s.created_at
  FROM public.field_availability_scenarios s
  LEFT JOIN public.field_availability_scenario_members m
    ON m.scenario_id = s.id
   AND m.organization_id = s.organization_id
  WHERE s.organization_id = p_organization_id
    AND s.season_label = p_season_label
  GROUP BY s.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_select_field_availability_scenario(
  p_organization_id uuid,
  p_season_label text,
  p_exclusivity_group text,
  p_scenario_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_selected public.field_availability_scenarios%ROWTYPE;
  v_previous_active_id uuid;
  v_now timestamptz := timezone('utc', now());
BEGIN
  IF p_organization_id IS NULL OR p_scenario_id IS NULL OR p_season_label IS NULL OR btrim(p_season_label) = '' OR p_exclusivity_group IS NULL OR btrim(p_exclusivity_group) = '' THEN
    RAISE EXCEPTION 'organization_id, season_label, exclusivity_group, and scenario_id are required' USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_selected
  FROM public.field_availability_scenarios s
  WHERE s.id = p_scenario_id
    AND s.organization_id = p_organization_id
    AND s.season_label = p_season_label
    AND s.exclusivity_group = p_exclusivity_group
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Scenario % not found for org/season/group', p_scenario_id USING ERRCODE = 'P0002';
  END IF;

  SELECT s.id
    INTO v_previous_active_id
  FROM public.field_availability_scenarios s
  WHERE s.organization_id = p_organization_id
    AND s.season_label = p_season_label
    AND s.exclusivity_group = p_exclusivity_group
    AND s.is_active
  LIMIT 1
  FOR UPDATE;

  IF v_previous_active_id = p_scenario_id THEN
    RETURN jsonb_build_object(
      'status', 'no_op',
      'previous_active_scenario_id', v_previous_active_id,
      'active_scenario_id', p_scenario_id
    );
  END IF;

  UPDATE public.field_availability_scenarios s
  SET is_active = (s.id = p_scenario_id)
  WHERE s.organization_id = p_organization_id
    AND s.season_label = p_season_label
    AND s.exclusivity_group = p_exclusivity_group
    AND s.is_active IS DISTINCT FROM (s.id = p_scenario_id);

  PERFORM public.record_audit_event(
    p_organization_id,
    'settings.updated',
    'field_availability_scenario',
    p_scenario_id,
    jsonb_build_object(
      'season_label', p_season_label,
      'exclusivity_group', p_exclusivity_group,
      'previous_active_scenario_id', v_previous_active_id,
      'new_active_scenario_id', p_scenario_id,
      'selected_at', v_now
    )
  );

  RETURN jsonb_build_object(
    'status', 'selected',
    'previous_active_scenario_id', v_previous_active_id,
    'active_scenario_id', p_scenario_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_field_availability_scenarios(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_select_field_availability_scenario(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_field_availability_scenarios(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_select_field_availability_scenario(uuid, text, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.get_field_availability_scenarios(uuid, text)
IS 'Admin-only org-scoped list of field availability scenarios for a season, including member counts and active flags.';

COMMENT ON FUNCTION public.admin_select_field_availability_scenario(uuid, text, text, uuid)
IS 'Admin-only org-scoped scenario selector that atomically enforces one active scenario per org/season/exclusivity group and records audit evidence.';

COMMIT;
