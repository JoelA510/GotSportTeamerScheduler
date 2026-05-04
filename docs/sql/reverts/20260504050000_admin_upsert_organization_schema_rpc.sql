-- Emergency rollback for 20260504050000_admin_upsert_organization_schema_rpc.sql.
--
-- Pair with an app rollback if the frontend still calls
-- admin_upsert_organization_schema. This restores the previous broad
-- org-member policy for organization_schemas.

BEGIN;

DROP FUNCTION IF EXISTS public.admin_upsert_organization_schema(uuid, text, jsonb, text);

DROP POLICY IF EXISTS "Schema Access: Org Members Select"
  ON public.organization_schemas;

DROP POLICY IF EXISTS "Schema Access: Org Members Only"
  ON public.organization_schemas;
CREATE POLICY "Schema Access: Org Members Only"
  ON public.organization_schemas
  FOR ALL
  USING (public.is_org_member(organization_id));

COMMIT;
