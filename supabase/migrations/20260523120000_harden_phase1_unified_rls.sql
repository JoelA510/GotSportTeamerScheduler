-- Harden Phase 1 unified RLS: restrict writes and derive org_id from parents.

begin;

-- Replace broad FOR ALL policies with explicit read/write separation.

-- field_subunits
DROP POLICY IF EXISTS "Unified org access on field_subunits" ON public.field_subunits;
CREATE POLICY "Org members can read field_subunits"
  ON public.field_subunits FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write field_subunits"
  ON public.field_subunits FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- practice_slots
DROP POLICY IF EXISTS "Unified org access on practice_slots" ON public.practice_slots;
CREATE POLICY "Org members can read practice_slots"
  ON public.practice_slots FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write practice_slots"
  ON public.practice_slots FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- game_slots
DROP POLICY IF EXISTS "Unified org access on game_slots" ON public.game_slots;
CREATE POLICY "Org members can read game_slots"
  ON public.game_slots FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write game_slots"
  ON public.game_slots FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- team_players
DROP POLICY IF EXISTS "Unified org access on team_players" ON public.team_players;
CREATE POLICY "Org members can read team_players"
  ON public.team_players FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write team_players"
  ON public.team_players FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- practice_assignments
DROP POLICY IF EXISTS "Unified org access on practice_assignments" ON public.practice_assignments;
CREATE POLICY "Org members can read practice_assignments"
  ON public.practice_assignments FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write practice_assignments"
  ON public.practice_assignments FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- games
DROP POLICY IF EXISTS "Unified org access on games" ON public.games;
CREATE POLICY "Org members can read games"
  ON public.games FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write games"
  ON public.games FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- staging_players
DROP POLICY IF EXISTS "Unified org access on staging_players" ON public.staging_players;
CREATE POLICY "Org members can read staging_players"
  ON public.staging_players FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write staging_players"
  ON public.staging_players FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- player_buddies
DROP POLICY IF EXISTS "Unified org access on player_buddies" ON public.player_buddies;
CREATE POLICY "Org members can read player_buddies"
  ON public.player_buddies FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write player_buddies"
  ON public.player_buddies FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- evaluation_runs
DROP POLICY IF EXISTS "Unified org access on evaluation_runs" ON public.evaluation_runs;
CREATE POLICY "Org members can read evaluation_runs"
  ON public.evaluation_runs FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write evaluation_runs"
  ON public.evaluation_runs FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- evaluation_findings
DROP POLICY IF EXISTS "Unified org access on evaluation_findings" ON public.evaluation_findings;
CREATE POLICY "Org members can read evaluation_findings"
  ON public.evaluation_findings FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write evaluation_findings"
  ON public.evaluation_findings FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- evaluation_metrics
DROP POLICY IF EXISTS "Unified org access on evaluation_metrics" ON public.evaluation_metrics;
CREATE POLICY "Org members can read evaluation_metrics"
  ON public.evaluation_metrics FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write evaluation_metrics"
  ON public.evaluation_metrics FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- evaluation_run_events
DROP POLICY IF EXISTS "Unified org access on evaluation_run_events" ON public.evaluation_run_events;
CREATE POLICY "Org members can read evaluation_run_events"
  ON public.evaluation_run_events FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write evaluation_run_events"
  ON public.evaluation_run_events FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- export_jobs
DROP POLICY IF EXISTS "Unified org access on export_jobs" ON public.export_jobs;
CREATE POLICY "Org members can read export_jobs"
  ON public.export_jobs FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write export_jobs"
  ON public.export_jobs FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- email_log
DROP POLICY IF EXISTS "Unified org access on email_log" ON public.email_log;
CREATE POLICY "Org members can read email_log"
  ON public.email_log FOR SELECT TO authenticated
  USING (public.is_org_member(organization_id));
CREATE POLICY "Org admins can write email_log"
  ON public.email_log FOR ALL TO authenticated
  USING (public.is_org_admin(organization_id))
  WITH CHECK (public.is_org_admin(organization_id));

-- Force org_id derivation from parent references on both INSERT and UPDATE.
CREATE OR REPLACE FUNCTION public.propagate_org_id_from_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.team_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM public.teams
    WHERE id = NEW.team_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.propagate_org_id_from_home_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.home_team_id IS NOT NULL THEN
    SELECT organization_id INTO NEW.organization_id
    FROM public.teams
    WHERE id = NEW.home_team_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_org_id_team_players ON public.team_players;
CREATE TRIGGER set_org_id_team_players
  BEFORE INSERT OR UPDATE ON public.team_players
  FOR EACH ROW EXECUTE FUNCTION public.propagate_org_id_from_team();

DROP TRIGGER IF EXISTS set_org_id_practice_assignments ON public.practice_assignments;
CREATE TRIGGER set_org_id_practice_assignments
  BEFORE INSERT OR UPDATE ON public.practice_assignments
  FOR EACH ROW EXECUTE FUNCTION public.propagate_org_id_from_team();

DROP TRIGGER IF EXISTS set_org_id_games ON public.games;
CREATE TRIGGER set_org_id_games
  BEFORE INSERT OR UPDATE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.propagate_org_id_from_home_team();

commit;
