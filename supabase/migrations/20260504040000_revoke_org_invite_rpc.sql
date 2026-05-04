-- Route organization invite revocation through an audited admin RPC.
--
-- Invite creation/redeem already flow through RPCs, but settings still revoked
-- unused invites with a direct browser DELETE. Keep the destructive mutation
-- org-scoped and auditable, then remove the direct DELETE policy.

BEGIN;

DROP POLICY IF EXISTS "Invites: admins delete unused"
  ON public.organization_invites;

CREATE OR REPLACE FUNCTION public.revoke_org_invite(
    p_organization_id uuid,
    p_invite_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_invite public.organization_invites%ROWTYPE;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF p_invite_id IS NULL THEN
        RAISE EXCEPTION 'p_invite_id is required'
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

    SELECT *
      INTO v_invite
      FROM public.organization_invites
     WHERE id = p_invite_id
     FOR UPDATE;

    IF v_invite.id IS NULL THEN
        RAISE EXCEPTION 'Invite % was not found', p_invite_id
            USING ERRCODE = '22023';
    END IF;

    IF v_invite.organization_id <> p_organization_id THEN
        RAISE EXCEPTION 'Invite % does not belong to organization %', p_invite_id, p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF v_invite.used_at IS NOT NULL THEN
        RAISE EXCEPTION 'Invite % has already been used and cannot be revoked', p_invite_id
            USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.organization_invites
     WHERE id = v_invite.id;

    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'organization_invite',
        v_invite.id,
        jsonb_build_object(
            'setting', 'organization_invites',
            'operation', 'revoke',
            'invite_id', v_invite.id,
            'role', v_invite.role,
            'expires_at', v_invite.expires_at
        )
    );

    RETURN v_invite.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revoke_org_invite(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.revoke_org_invite(uuid, uuid) IS
    'Admin-only invite revocation RPC. Deletes unused invites for the caller organization and records settings.updated audit evidence.';

COMMENT ON TABLE public.organization_invites IS
  'Single-use invite codes that add an auth.users member to an org with a preset role. Create/redeem/revoke mutations flow through RPCs.';

COMMIT;
