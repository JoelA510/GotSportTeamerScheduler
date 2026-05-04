-- Emergency rollback for 20260504060000_admin_facility_mutation_rpcs.sql.
--
-- Pair with an app rollback if the frontend still calls the admin facility
-- RPCs. This restores the previous broad org-member facility write policies.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_delete_field(uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_update_field(uuid, uuid, uuid, text, text, text, boolean, integer, boolean);
DROP FUNCTION IF EXISTS public.admin_create_field(uuid, uuid, text, text, text, boolean, integer, boolean);
DROP FUNCTION IF EXISTS public.admin_create_location(uuid, text, text, boolean);

DROP POLICY IF EXISTS "Locations: members select" ON public.locations;
DROP POLICY IF EXISTS "Fields: members select" ON public.fields;
DROP POLICY IF EXISTS "Field Subunits: members select" ON public.field_subunits;
DROP POLICY IF EXISTS "Practice Slots: members select" ON public.practice_slots;

DROP POLICY IF EXISTS "Locations: members access" ON public.locations;
CREATE POLICY "Locations: members access"
  ON public.locations FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Strict org access on locations" ON public.locations;
CREATE POLICY "Strict org access on locations"
  ON public.locations FOR ALL
  TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Fields: members access" ON public.fields;
CREATE POLICY "Fields: members access"
  ON public.fields FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Strict org access on fields" ON public.fields;
CREATE POLICY "Strict org access on fields"
  ON public.fields FOR ALL
  TO authenticated
  USING (public.is_org_member((SELECT organization_id FROM public.locations WHERE id = location_id)))
  WITH CHECK (public.is_org_member((SELECT organization_id FROM public.locations WHERE id = location_id)));

DROP POLICY IF EXISTS "Field Subunits: members access" ON public.field_subunits;
CREATE POLICY "Field Subunits: members access"
  ON public.field_subunits FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Unified org access on field_subunits" ON public.field_subunits;
CREATE POLICY "Unified org access on field_subunits"
  ON public.field_subunits FOR ALL
  TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Practice Slots: members access" ON public.practice_slots;
CREATE POLICY "Practice Slots: members access"
  ON public.practice_slots FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

DROP POLICY IF EXISTS "Unified org access on practice_slots" ON public.practice_slots;
CREATE POLICY "Unified org access on practice_slots"
  ON public.practice_slots FOR ALL
  TO authenticated
  USING (public.is_org_member(organization_id))
  WITH CHECK (public.is_org_member(organization_id));

COMMIT;
