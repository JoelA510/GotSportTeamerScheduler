-- Route facility management mutations through audited org-admin RPCs.
--
-- FieldManagementPage previously inserted/updated/deleted locations and
-- fields directly from the browser, while facility RLS allowed broad
-- org-member writes. Keep facility reads available to org members and move
-- write paths to narrow admin RPCs.

BEGIN;

DROP POLICY IF EXISTS "Locations: members access" ON public.locations;
DROP POLICY IF EXISTS "Strict org access on locations" ON public.locations;
DROP POLICY IF EXISTS "Fields: members access" ON public.fields;
DROP POLICY IF EXISTS "Strict org access on fields" ON public.fields;
DROP POLICY IF EXISTS "Field Subunits: members access" ON public.field_subunits;
DROP POLICY IF EXISTS "Unified org access on field_subunits" ON public.field_subunits;
DROP POLICY IF EXISTS "Practice Slots: members access" ON public.practice_slots;
DROP POLICY IF EXISTS "Unified org access on practice_slots" ON public.practice_slots;

CREATE POLICY "Locations: members select"
  ON public.locations FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "Fields: members select"
  ON public.fields FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "Field Subunits: members select"
  ON public.field_subunits FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE POLICY "Practice Slots: members select"
  ON public.practice_slots FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

CREATE OR REPLACE FUNCTION public.admin_create_location(
    p_organization_id uuid,
    p_name text,
    p_address text DEFAULT NULL,
    p_lighting_available boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name text := btrim(COALESCE(p_name, ''));
    v_location public.locations%ROWTYPE;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF v_name = '' THEN
        RAISE EXCEPTION 'location name is required'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.locations (
        organization_id,
        name,
        address,
        lighting_available
    )
    VALUES (
        p_organization_id,
        v_name,
        NULLIF(btrim(COALESCE(p_address, '')), ''),
        COALESCE(p_lighting_available, false)
    )
    RETURNING * INTO v_location;

    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'location',
        v_location.id,
        jsonb_build_object(
            'setting', 'facility.location',
            'operation', 'created',
            'current', to_jsonb(v_location)
        )
    );

    RETURN to_jsonb(v_location);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_field(
    p_organization_id uuid,
    p_location_id uuid,
    p_name text,
    p_surface_type text DEFAULT NULL,
    p_size text DEFAULT NULL,
    p_supports_halves boolean DEFAULT false,
    p_priority_rating integer DEFAULT 1,
    p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name text := btrim(COALESCE(p_name, ''));
    v_location_org uuid;
    v_field public.fields%ROWTYPE;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF p_location_id IS NULL THEN
        RAISE EXCEPTION 'p_location_id is required'
            USING ERRCODE = '23502';
    END IF;

    SELECT organization_id
      INTO v_location_org
      FROM public.locations
     WHERE id = p_location_id;

    IF v_location_org IS NULL OR v_location_org <> p_organization_id THEN
        RAISE EXCEPTION 'Access denied: location is outside organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF v_name = '' THEN
        RAISE EXCEPTION 'field name is required'
            USING ERRCODE = '22023';
    END IF;

    IF COALESCE(p_priority_rating, 1) < 1 THEN
        RAISE EXCEPTION 'priority_rating must be at least 1'
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.fields (
        organization_id,
        location_id,
        name,
        surface_type,
        size,
        supports_halves,
        priority_rating,
        active
    )
    VALUES (
        p_organization_id,
        p_location_id,
        v_name,
        NULLIF(btrim(COALESCE(p_surface_type, '')), ''),
        NULLIF(btrim(COALESCE(p_size, '')), ''),
        COALESCE(p_supports_halves, false),
        COALESCE(p_priority_rating, 1),
        COALESCE(p_active, true)
    )
    RETURNING * INTO v_field;

    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'field',
        v_field.id,
        jsonb_build_object(
            'setting', 'facility.field',
            'operation', 'created',
            'current', to_jsonb(v_field)
        )
    );

    RETURN to_jsonb(v_field);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_field(
    p_organization_id uuid,
    p_field_id uuid,
    p_location_id uuid,
    p_name text,
    p_surface_type text DEFAULT NULL,
    p_size text DEFAULT NULL,
    p_supports_halves boolean DEFAULT false,
    p_priority_rating integer DEFAULT 1,
    p_active boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_name text := btrim(COALESCE(p_name, ''));
    v_location_org uuid;
    v_existing public.fields%ROWTYPE;
    v_field public.fields%ROWTYPE;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF p_field_id IS NULL THEN
        RAISE EXCEPTION 'p_field_id is required'
            USING ERRCODE = '23502';
    END IF;

    SELECT *
      INTO v_existing
      FROM public.fields
     WHERE id = p_field_id
       AND organization_id = p_organization_id
     FOR UPDATE;

    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'field % was not found in organization %', p_field_id, p_organization_id
            USING ERRCODE = 'P0002';
    END IF;

    IF p_location_id IS NULL THEN
        RAISE EXCEPTION 'p_location_id is required'
            USING ERRCODE = '23502';
    END IF;

    SELECT organization_id
      INTO v_location_org
      FROM public.locations
     WHERE id = p_location_id;

    IF v_location_org IS NULL OR v_location_org <> p_organization_id THEN
        RAISE EXCEPTION 'Access denied: location is outside organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF v_name = '' THEN
        RAISE EXCEPTION 'field name is required'
            USING ERRCODE = '22023';
    END IF;

    IF COALESCE(p_priority_rating, 1) < 1 THEN
        RAISE EXCEPTION 'priority_rating must be at least 1'
            USING ERRCODE = '22023';
    END IF;

    UPDATE public.fields
       SET location_id = p_location_id,
           name = v_name,
           surface_type = NULLIF(btrim(COALESCE(p_surface_type, '')), ''),
           size = NULLIF(btrim(COALESCE(p_size, '')), ''),
           supports_halves = COALESCE(p_supports_halves, false),
           priority_rating = COALESCE(p_priority_rating, 1),
           active = COALESCE(p_active, true),
           updated_at = timezone('utc', now())
     WHERE id = p_field_id
       AND organization_id = p_organization_id
    RETURNING * INTO v_field;

    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'field',
        v_field.id,
        jsonb_build_object(
            'setting', 'facility.field',
            'operation', 'updated',
            'previous', to_jsonb(v_existing),
            'current', to_jsonb(v_field)
        )
    );

    RETURN to_jsonb(v_field);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_field(
    p_organization_id uuid,
    p_field_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing public.fields%ROWTYPE;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF p_field_id IS NULL THEN
        RAISE EXCEPTION 'p_field_id is required'
            USING ERRCODE = '23502';
    END IF;

    DELETE FROM public.fields
     WHERE id = p_field_id
       AND organization_id = p_organization_id
    RETURNING * INTO v_existing;

    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'field % was not found in organization %', p_field_id, p_organization_id
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'field',
        v_existing.id,
        jsonb_build_object(
            'setting', 'facility.field',
            'operation', 'deleted',
            'previous', to_jsonb(v_existing)
        )
    );

    RETURN jsonb_build_object(
        'id', v_existing.id,
        'organization_id', v_existing.organization_id,
        'deleted', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_location(uuid, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_create_field(uuid, uuid, text, text, text, boolean, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_update_field(uuid, uuid, uuid, text, text, text, boolean, integer, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_field(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_create_location(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_field(uuid, uuid, text, text, text, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_field(uuid, uuid, uuid, text, text, text, boolean, integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_field(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_create_location(uuid, text, text, boolean) IS
  'Admin-only org-scoped facility location creation with settings.updated audit logging.';
COMMENT ON FUNCTION public.admin_create_field(uuid, uuid, text, text, text, boolean, integer, boolean) IS
  'Admin-only org-scoped field creation with location scoping checks and settings.updated audit logging.';
COMMENT ON FUNCTION public.admin_update_field(uuid, uuid, uuid, text, text, text, boolean, integer, boolean) IS
  'Admin-only org-scoped field update with location scoping checks and settings.updated audit logging.';
COMMENT ON FUNCTION public.admin_delete_field(uuid, uuid) IS
  'Admin-only org-scoped field deletion with settings.updated audit logging.';

COMMIT;
