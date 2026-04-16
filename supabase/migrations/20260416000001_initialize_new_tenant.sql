-- ==========================================
-- ONBOARDING: initialize_new_tenant RPC
-- ==========================================

BEGIN;

CREATE OR REPLACE FUNCTION public.initialize_new_tenant(
    p_name text,
    p_slug text,
    p_timezone text,
    p_season_year integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
    v_user_id uuid;
BEGIN
    -- Get calling user
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Create Organization
    INSERT INTO public.organizations (name, slug, contact_info)
    VALUES (
        p_name, 
        p_slug, 
        jsonb_build_object('timezone', p_timezone)
    )
    RETURNING id INTO v_org_id;

    -- Assign Caller as Admin
    INSERT INTO public.organization_members (organization_id, profile_id, role)
    VALUES (v_org_id, v_user_id, 'admin');

    -- Create Initial Season Settings
    -- Note: season_settings status is draft until confirmed by user usually, 
    -- but we set to 'active' for immediate use in self-serve flow if intended.
    INSERT INTO public.season_settings (
        organization_id, 
        name, 
        status, 
        season_year,
        season_label
    )
    VALUES (
        v_org_id, 
        p_season_year::text || ' Season', 
        'active', 
        p_season_year,
        p_season_year::text || ' Season'
    );

    -- record auditing
    -- Ensure record_audit_event exists before calling
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_audit_event') THEN
        PERFORM public.record_audit_event(
            v_org_id,
            'settings.updated',
            'organization',
            v_org_id,
            jsonb_build_object('action', 'initialization', 'creator', v_user_id)
        );
    END IF;

    RETURN v_org_id;
END;
$$;

COMMIT;
