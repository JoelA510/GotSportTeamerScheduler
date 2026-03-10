-- strict_rls_multi_tenancy.sql
-- Enforces strict organization_id checks across all major tables.

-- 1. Helper function for RLS
CREATE OR REPLACE FUNCTION public.is_org_member(org_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM organization_members 
        WHERE organization_id = org_id 
        AND profile_id = auth.uid()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Add organization_id to top-level entities missing it
ALTER TABLE locations ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE coaches ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);
ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id);

-- 3. Replace old "Admin can do everything" policies with strict org checks

-- Season Settings
DROP POLICY IF EXISTS "Admins can do everything on season_settings" ON season_settings;
CREATE POLICY "Strict org access on season_settings"
  ON season_settings FOR ALL TO authenticated
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

-- Locations
DROP POLICY IF EXISTS "Admins can do everything on locations" ON locations;
CREATE POLICY "Strict org access on locations"
  ON locations FOR ALL TO authenticated
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

-- Fields (inherits from locations)
DROP POLICY IF EXISTS "Admins can do everything on fields" ON fields;
CREATE POLICY "Strict org access on fields"
  ON fields FOR ALL TO authenticated
  USING (is_org_member((SELECT organization_id FROM locations WHERE id = location_id)))
  WITH CHECK (is_org_member((SELECT organization_id FROM locations WHERE id = location_id)));

-- Coaches
DROP POLICY IF EXISTS "Admins can do everything on coaches" ON coaches;
CREATE POLICY "Strict org access on coaches"
  ON coaches FOR ALL TO authenticated
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

-- Import Jobs
DROP POLICY IF EXISTS "Admins can do everything on import_jobs" ON import_jobs;
CREATE POLICY "Strict org access on import_jobs"
  ON import_jobs FOR ALL TO authenticated
  USING (is_org_member(organization_id))
  WITH CHECK (is_org_member(organization_id));

-- Divisions
DROP POLICY IF EXISTS "Admins can do everything on divisions" ON divisions;
CREATE POLICY "Strict org access on divisions"
  ON divisions FOR ALL TO authenticated
  USING (is_org_member((SELECT organization_id FROM season_settings WHERE id = season_settings_id)))
  WITH CHECK (is_org_member((SELECT organization_id FROM season_settings WHERE id = season_settings_id)));

-- Teams
DROP POLICY IF EXISTS "Admins can do everything on teams" ON teams;
CREATE POLICY "Strict org access on teams"
  ON teams FOR ALL TO authenticated
  USING (is_org_member((
      SELECT ss.organization_id 
      FROM season_settings ss 
      JOIN divisions d ON d.season_settings_id = ss.id 
      WHERE d.id = division_id
  )))
  WITH CHECK (is_org_member((
      SELECT ss.organization_id 
      FROM season_settings ss 
      JOIN divisions d ON d.season_settings_id = ss.id 
      WHERE d.id = division_id
  )));

-- Players
DROP POLICY IF EXISTS "Admins can do everything on players" ON players;
CREATE POLICY "Strict org access on players"
  ON players FOR ALL TO authenticated
  USING (is_org_member((
      SELECT ss.organization_id 
      FROM season_settings ss 
      JOIN divisions d ON d.season_settings_id = ss.id 
      WHERE d.id = division_id
  )))
  WITH CHECK (is_org_member((
      SELECT ss.organization_id 
      FROM season_settings ss 
      JOIN divisions d ON d.season_settings_id = ss.id 
      WHERE d.id = division_id
  )));
