-- Members: audited remove + role-change RPCs.
--
-- MembersPage had invite management but no way to remove an existing member
-- or change their role.  Both actions already appear in the audit_log
-- whitelist ('member.removed', 'member.role_changed').

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

    -- Block removing the last admin.
    IF v_member_role = 'admin' THEN
        SELECT count(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = p_organization_id AND role = 'admin';
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

    -- Block demoting the last admin (including yourself).
    IF v_old_role = 'admin' AND p_role <> 'admin' THEN
        SELECT count(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = p_organization_id AND role = 'admin';
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

REVOKE EXECUTE ON FUNCTION public.admin_remove_member(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_change_member_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_remove_member(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_change_member_role(uuid, uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_remove_member(uuid, uuid) IS
  'Audited org member removal; blocks removing self or last admin.';
COMMENT ON FUNCTION public.admin_change_member_role(uuid, uuid, text) IS
  'Audited org member role change; blocks demoting last admin.';
