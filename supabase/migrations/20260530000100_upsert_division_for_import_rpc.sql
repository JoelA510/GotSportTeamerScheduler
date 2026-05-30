-- Division auto-create from GotSport program data.
--
-- Idempotent upsert of a division (keyed by season_settings_id + name) with its
-- gender policy, age band, and birthdate window. Lets the import / teaming flow
-- materialize the pilot's programs (e.g. "2026 U05G Grasshopper Registration")
-- as divisions instead of silently leaving players unassigned when no division
-- name matches. Age bands/windows are computed client-side by the core
-- ageGroups module (calendar or Aug-Jul) and passed in.
--
-- Self-contained: depends only on divisions, gender_policy_enum, and
-- is_org_admin — all present on the base schema.
--
-- Revert: docs/sql/20260530000100_revert.sql
-- Smoke:  docs/sql/20260530000100_smoke.sql

CREATE OR REPLACE FUNCTION public.upsert_division_for_import(
  p_organization_id uuid,
  p_season_settings_id uuid,
  p_name text,
  p_gender text DEFAULT NULL,
  p_min_age integer DEFAULT NULL,
  p_max_age integer DEFAULT NULL,
  p_birthdate_start date DEFAULT NULL,
  p_birthdate_end date DEFAULT NULL
) RETURNS public.divisions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_division public.divisions;
  v_gender public.gender_policy_enum;
BEGIN
  IF NOT public.is_org_admin(p_organization_id) THEN
    RAISE EXCEPTION 'Access denied: admin required for organization %', p_organization_id
      USING ERRCODE = '42501';
  END IF;

  -- The season must belong to the same organization, otherwise an admin of one
  -- org could create/update a division under another org's season.
  IF NOT EXISTS (
    SELECT 1 FROM public.season_settings s
    WHERE s.id = p_season_settings_id
      AND s.organization_id = p_organization_id
  ) THEN
    RAISE EXCEPTION 'season % does not belong to organization %',
      p_season_settings_id, p_organization_id
      USING ERRCODE = '42501';
  END IF;

  IF p_name IS NULL OR btrim(p_name) = '' THEN
    RAISE EXCEPTION 'division name is required';
  END IF;

  v_gender := (
    CASE
      WHEN lower(coalesce(p_gender, '')) IN ('g', 'girls', 'girl', 'female', 'f', 'women') THEN 'girls'
      WHEN lower(coalesce(p_gender, '')) IN ('b', 'boys', 'boy', 'male', 'm', 'men') THEN 'boys'
      WHEN lower(coalesce(p_gender, '')) IN ('coed', 'co-ed', 'both', 'mixed') THEN 'coed'
      ELSE 'coed'
    END
  )::public.gender_policy_enum;

  INSERT INTO public.divisions AS d (
    organization_id, season_settings_id, name, gender_policy,
    min_age, max_age, birthdate_start, birthdate_end
  )
  VALUES (
    p_organization_id, p_season_settings_id, btrim(p_name), v_gender,
    p_min_age, p_max_age, p_birthdate_start, p_birthdate_end
  )
  ON CONFLICT (season_settings_id, name) DO UPDATE SET
    gender_policy   = EXCLUDED.gender_policy,
    min_age         = COALESCE(EXCLUDED.min_age, d.min_age),
    max_age         = COALESCE(EXCLUDED.max_age, d.max_age),
    birthdate_start = COALESCE(EXCLUDED.birthdate_start, d.birthdate_start),
    birthdate_end   = COALESCE(EXCLUDED.birthdate_end, d.birthdate_end),
    updated_at      = timezone('utc', now())
  RETURNING * INTO v_division;

  RETURN v_division;
END;
$$;

GRANT EXECUTE ON FUNCTION public.upsert_division_for_import(
  uuid, uuid, text, text, integer, integer, date, date
) TO authenticated;

COMMENT ON FUNCTION public.upsert_division_for_import(uuid, uuid, text, text, integer, integer, date, date) IS
  'Idempotent division upsert (auto-create from GotSport program/age-group/gender). Admin-gated; bands/windows supplied by the client age-group deriver.';
