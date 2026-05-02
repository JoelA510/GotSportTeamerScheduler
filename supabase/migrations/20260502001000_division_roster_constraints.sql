BEGIN;

ALTER TABLE public.divisions
    ADD COLUMN IF NOT EXISTS min_roster_size integer,
    ADD COLUMN IF NOT EXISTS target_team_size integer,
    ADD COLUMN IF NOT EXISTS team_count_override integer,
    ADD COLUMN IF NOT EXISTS min_teams integer,
    ADD COLUMN IF NOT EXISTS max_teams integer;

ALTER TABLE public.divisions
    DROP CONSTRAINT IF EXISTS divisions_max_roster_size_positive,
    DROP CONSTRAINT IF EXISTS divisions_min_roster_size_positive,
    DROP CONSTRAINT IF EXISTS divisions_target_team_size_positive,
    DROP CONSTRAINT IF EXISTS divisions_team_count_override_positive,
    DROP CONSTRAINT IF EXISTS divisions_min_teams_positive,
    DROP CONSTRAINT IF EXISTS divisions_max_teams_positive,
    DROP CONSTRAINT IF EXISTS divisions_roster_size_bounds,
    DROP CONSTRAINT IF EXISTS divisions_team_count_bounds,
    DROP CONSTRAINT IF EXISTS divisions_team_count_override_min_bound,
    DROP CONSTRAINT IF EXISTS divisions_team_count_override_max_bound;

ALTER TABLE public.divisions
    ADD CONSTRAINT divisions_max_roster_size_positive
        CHECK (max_roster_size IS NULL OR max_roster_size > 0),
    ADD CONSTRAINT divisions_min_roster_size_positive
        CHECK (min_roster_size IS NULL OR min_roster_size > 0),
    ADD CONSTRAINT divisions_target_team_size_positive
        CHECK (target_team_size IS NULL OR target_team_size > 0),
    ADD CONSTRAINT divisions_team_count_override_positive
        CHECK (team_count_override IS NULL OR team_count_override > 0),
    ADD CONSTRAINT divisions_min_teams_positive
        CHECK (min_teams IS NULL OR min_teams > 0),
    ADD CONSTRAINT divisions_max_teams_positive
        CHECK (max_teams IS NULL OR max_teams > 0),
    ADD CONSTRAINT divisions_roster_size_bounds
        CHECK (
            min_roster_size IS NULL
            OR max_roster_size IS NULL
            OR min_roster_size <= max_roster_size
        ),
    ADD CONSTRAINT divisions_team_count_bounds
        CHECK (
            min_teams IS NULL
            OR max_teams IS NULL
            OR min_teams <= max_teams
        ),
    ADD CONSTRAINT divisions_team_count_override_min_bound
        CHECK (
            team_count_override IS NULL
            OR min_teams IS NULL
            OR team_count_override >= min_teams
        ),
    ADD CONSTRAINT divisions_team_count_override_max_bound
        CHECK (
            team_count_override IS NULL
            OR max_teams IS NULL
            OR team_count_override <= max_teams
        );

CREATE OR REPLACE FUNCTION public.enforce_division_season_org_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_season_org_id uuid;
BEGIN
    SELECT season_settings.organization_id
      INTO v_season_org_id
      FROM public.season_settings
     WHERE season_settings.id = NEW.season_settings_id;

    IF v_season_org_id IS NULL THEN
        RAISE EXCEPTION 'season_settings_id % does not exist', NEW.season_settings_id
            USING ERRCODE = '23503';
    END IF;

    IF NEW.organization_id IS NULL THEN
        NEW.organization_id := v_season_org_id;
    ELSIF NEW.organization_id <> v_season_org_id THEN
        RAISE EXCEPTION 'division organization_id must match season_settings organization_id'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_division_season_org_match ON public.divisions;
CREATE TRIGGER enforce_division_season_org_match
    BEFORE INSERT OR UPDATE OF organization_id, season_settings_id ON public.divisions
    FOR EACH ROW EXECUTE FUNCTION public.enforce_division_season_org_match();

DROP POLICY IF EXISTS "Unified org access on divisions" ON public.divisions;
DROP POLICY IF EXISTS "Strict org access on divisions" ON public.divisions;
DROP POLICY IF EXISTS "Divisions: members access" ON public.divisions;
DROP POLICY IF EXISTS "Divisions: org members select" ON public.divisions;
DROP POLICY IF EXISTS "Divisions: org admins insert" ON public.divisions;
DROP POLICY IF EXISTS "Divisions: org admins update" ON public.divisions;
DROP POLICY IF EXISTS "Divisions: org admins delete" ON public.divisions;

CREATE POLICY "Divisions: org members select"
    ON public.divisions FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE POLICY "Divisions: org admins insert"
    ON public.divisions FOR INSERT TO authenticated
    WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "Divisions: org admins update"
    ON public.divisions FOR UPDATE TO authenticated
    USING (public.is_org_admin(organization_id))
    WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "Divisions: org admins delete"
    ON public.divisions FOR DELETE TO authenticated
    USING (public.is_org_admin(organization_id));

COMMIT;
