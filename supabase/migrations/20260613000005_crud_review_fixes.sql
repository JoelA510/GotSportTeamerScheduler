-- Review fixes for the universal CRUD RPCs (PR #327 bot review):
--
-- 1. admin_update_registration_form: a patched season_id must belong to the
--    form's organization (the create RPC already enforced this).
-- 2. admin_create_registration_form: accept p_waiver_text so the create
--    editor's waiver field actually persists. Old 7-arg signature is dropped
--    to avoid PostgREST overload ambiguity.
-- 3. admin_remove_member / admin_change_member_role: the "last admin" guard
--    now counts tenant_admin as admin-equivalent, matching is_org_admin.
-- 4. get_organization_members: SECURITY DEFINER read path for the Members
--    page — profiles RLS only lets users read their own row, so the embedded
--    profiles(...) join returns null for everyone else.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Season org check on form update
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_registration_form(
    p_form_id   uuid,
    p_patch     jsonb
)
RETURNS public.registration_forms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_form public.registration_forms%ROWTYPE;
    v_key  text;
    v_season_org_id uuid;
BEGIN
    SELECT * INTO v_form FROM public.registration_forms WHERE id = p_form_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'registration form % not found', p_form_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.is_org_admin(v_form.organization_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', v_form.organization_id
            USING ERRCODE = '42501';
    END IF;
    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
        RAISE EXCEPTION 'patch must be a JSON object' USING ERRCODE = '22023';
    END IF;

    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
        IF v_key NOT IN ('title', 'description', 'status', 'waiver_text', 'fields', 'season_id') THEN
            RAISE EXCEPTION 'field % is not editable on registration_forms', v_key
                USING ERRCODE = '22023';
        END IF;
    END LOOP;

    IF p_patch ? 'title' AND (p_patch->>'title' IS NULL OR trim(p_patch->>'title') = '') THEN
        RAISE EXCEPTION 'title cannot be empty' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'status' AND (p_patch->>'status') NOT IN ('draft', 'open', 'closed') THEN
        RAISE EXCEPTION 'invalid status: %', p_patch->>'status' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'fields' AND jsonb_typeof(p_patch->'fields') <> 'array' THEN
        RAISE EXCEPTION 'fields must be a JSON array' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'season_id' AND p_patch->>'season_id' IS NOT NULL THEN
        SELECT ss.organization_id INTO v_season_org_id
        FROM public.season_settings ss
        WHERE ss.id = (p_patch->>'season_id')::uuid;
        IF v_season_org_id IS NULL OR v_season_org_id <> v_form.organization_id THEN
            RAISE EXCEPTION 'Season settings do not belong to organization %', v_form.organization_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE public.registration_forms
    SET
        title        = CASE WHEN p_patch ? 'title'       THEN trim(p_patch->>'title')         ELSE title       END,
        description  = CASE WHEN p_patch ? 'description' THEN p_patch->>'description'          ELSE description END,
        status       = CASE WHEN p_patch ? 'status'      THEN p_patch->>'status'               ELSE status      END,
        waiver_text  = CASE WHEN p_patch ? 'waiver_text' THEN p_patch->>'waiver_text'           ELSE waiver_text END,
        fields       = CASE WHEN p_patch ? 'fields'      THEN p_patch->'fields'                 ELSE fields      END,
        season_id    = CASE WHEN p_patch ? 'season_id'   THEN (p_patch->>'season_id')::uuid     ELSE season_id   END,
        updated_at   = timezone('utc', now())
    WHERE id = p_form_id;

    PERFORM public.record_audit_event(
        v_form.organization_id,
        'registration.form_updated',
        'registration_forms',
        p_form_id,
        jsonb_build_object('patch_keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_patch) AS k))
    );

    SELECT * INTO v_form FROM public.registration_forms WHERE id = p_form_id;
    RETURN v_form;
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Waiver text on form creation
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.admin_create_registration_form(uuid, text, text, uuid, jsonb, text, jsonb);

CREATE OR REPLACE FUNCTION public.admin_create_registration_form(
    p_organization_id uuid,
    p_title text,
    p_description text DEFAULT NULL,
    p_season_id uuid DEFAULT NULL,
    p_fields jsonb DEFAULT '[]'::jsonb,
    p_status text DEFAULT 'open',
    p_waiver_text text DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_title text := btrim(COALESCE(p_title, ''));
    v_description text := NULLIF(btrim(COALESCE(p_description, '')), '');
    v_waiver_text text := NULLIF(btrim(COALESCE(p_waiver_text, '')), '');
    v_fields jsonb := COALESCE(p_fields, '[]'::jsonb);
    v_status text := lower(btrim(COALESCE(p_status, 'open')));
    v_metadata jsonb := COALESCE(p_metadata, '{}'::jsonb);
    v_season_org_id uuid;
    v_form public.registration_forms%ROWTYPE;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'authenticated user is required'
            USING ERRCODE = '42501';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF v_title = '' THEN
        RAISE EXCEPTION 'p_title is required'
            USING ERRCODE = '23502';
    END IF;

    IF jsonb_typeof(v_fields) <> 'array' THEN
        RAISE EXCEPTION 'p_fields must be a JSON array'
            USING ERRCODE = '22023';
    END IF;

    IF jsonb_typeof(v_metadata) <> 'object' THEN
        RAISE EXCEPTION 'p_metadata must be a JSON object'
            USING ERRCODE = '22023';
    END IF;

    IF v_status = 'active' THEN
        v_status := 'open';
    END IF;

    IF v_status NOT IN ('draft', 'open', 'closed') THEN
        RAISE EXCEPTION 'invalid registration form status: %', v_status
            USING ERRCODE = '23514';
    END IF;

    IF p_season_id IS NOT NULL THEN
        SELECT ss.organization_id
          INTO v_season_org_id
          FROM public.season_settings ss
         WHERE ss.id = p_season_id;

        IF v_season_org_id IS NULL OR v_season_org_id <> p_organization_id THEN
            RAISE EXCEPTION 'Season settings do not belong to organization %', p_organization_id
                USING ERRCODE = '42501';
        END IF;
    END IF;

    INSERT INTO public.registration_forms (
        organization_id,
        title,
        description,
        season_id,
        fields,
        status,
        waiver_text
    )
    VALUES (
        p_organization_id,
        v_title,
        v_description,
        p_season_id,
        v_fields,
        v_status,
        v_waiver_text
    )
    RETURNING * INTO v_form;

    PERFORM public.record_audit_event(
        p_organization_id,
        'registration.form_created',
        'registration_form',
        v_form.id,
        jsonb_build_object(
            'form_id', v_form.id,
            'title', v_form.title,
            'season_id', v_form.season_id,
            'field_count', jsonb_array_length(v_form.fields),
            'status', v_form.status
        ) || v_metadata
    );

    RETURN to_jsonb(v_form);
END;
$$;

-- ---------------------------------------------------------------------------
-- 3. tenant_admin counts toward last-admin protection
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_remove_member(
    p_organization_id uuid,
    p_profile_id      uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id  uuid := auth.uid();
    v_member_role text;
    v_admin_count integer;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required' USING ERRCODE = '23502';
    END IF;
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION 'p_profile_id is required' USING ERRCODE = '23502';
    END IF;
    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;
    IF v_caller_id = p_profile_id THEN
        RAISE EXCEPTION 'You cannot remove yourself from the organization'
            USING ERRCODE = '22023';
    END IF;

    SELECT role INTO v_member_role
    FROM public.organization_members
    WHERE organization_id = p_organization_id AND profile_id = p_profile_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member not found in organization' USING ERRCODE = 'P0002';
    END IF;

    -- Block removing the last admin-equivalent member.
    IF v_member_role IN ('admin', 'tenant_admin') THEN
        SELECT count(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = p_organization_id AND role IN ('admin', 'tenant_admin');
        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION 'Cannot remove the last admin from the organization'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    DELETE FROM public.organization_members
    WHERE organization_id = p_organization_id AND profile_id = p_profile_id;

    PERFORM public.record_audit_event(
        p_organization_id,
        'member.removed',
        'organization_members',
        p_profile_id,
        jsonb_build_object('role', v_member_role)
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_change_member_role(
    p_organization_id uuid,
    p_profile_id      uuid,
    p_role            text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id   uuid := auth.uid();
    v_old_role    text;
    v_admin_count integer;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required' USING ERRCODE = '23502';
    END IF;
    IF p_profile_id IS NULL THEN
        RAISE EXCEPTION 'p_profile_id is required' USING ERRCODE = '23502';
    END IF;
    IF p_role IS NULL OR p_role NOT IN ('admin', 'coach', 'player', 'parent', 'staff') THEN
        RAISE EXCEPTION 'invalid role: %', p_role USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    SELECT role INTO v_old_role
    FROM public.organization_members
    WHERE organization_id = p_organization_id AND profile_id = p_profile_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Member not found in organization' USING ERRCODE = 'P0002';
    END IF;

    -- Block demoting the last admin-equivalent member (including yourself).
    IF v_old_role IN ('admin', 'tenant_admin') AND p_role NOT IN ('admin', 'tenant_admin') THEN
        SELECT count(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = p_organization_id AND role IN ('admin', 'tenant_admin');
        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION 'Cannot demote the last admin of the organization'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE public.organization_members
    SET role = p_role
    WHERE organization_id = p_organization_id AND profile_id = p_profile_id;

    IF v_old_role IS DISTINCT FROM p_role THEN
        PERFORM public.record_audit_event(
            p_organization_id,
            'member.role_changed',
            'organization_members',
            p_profile_id,
            jsonb_build_object('previous_role', v_old_role, 'role', p_role)
        );
    END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Members list read path (profiles RLS bypass, org-membership gated)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_organization_members(p_organization_id uuid)
RETURNS TABLE (
    profile_id uuid,
    role text,
    created_at timestamptz,
    email text,
    full_name text,
    first_name text,
    last_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required' USING ERRCODE = '23502';
    END IF;
    IF NOT public.is_org_member(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: membership required for organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    RETURN QUERY
    SELECT om.profile_id, om.role, om.created_at,
           p.email, p.full_name, p.first_name, p.last_name
    FROM public.organization_members om
    LEFT JOIN public.profiles p ON p.id = om.profile_id
    WHERE om.organization_id = p_organization_id
    ORDER BY om.created_at ASC;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_create_registration_form(uuid, text, text, uuid, jsonb, text, text, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_organization_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_registration_form(uuid, text, text, uuid, jsonb, text, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_organization_members(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_organization_members(uuid) IS
  'Org-membership-gated member list with profile display fields (bypasses own-row-only profiles RLS).';

COMMIT;
