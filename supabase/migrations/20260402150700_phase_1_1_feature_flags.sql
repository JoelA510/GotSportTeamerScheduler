-- Phase 1.1: Feature Flags & Audit Logging
-- Adds feature_flags column to organizations and provides a secure, audited RPC for updates.

BEGIN;

-- 1. Add feature_flags column to organizations
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS feature_flags JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 2. Create the update_org_feature_flags RPC
--    This function is SECURITY DEFINER to allow admins to update flags 
--    regardless of their direct permissions on the organizations table.
CREATE OR REPLACE FUNCTION public.update_org_feature_flags(
    p_org_id UUID,
    p_flags JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_old_flags JSONB;
    v_new_flags JSONB := COALESCE(p_flags, '{}'::jsonb);
    v_audit_metadata JSONB;
BEGIN
    -- 1. Check if the current user is an admin for the specified organization
    --    Uses the is_org_admin() helper from core_auth.sql
    IF NOT is_org_admin(p_org_id) THEN
        RAISE EXCEPTION 'Unauthorized: You must be an organization administrator to update feature flags.';
    END IF;

    -- 2. Fetch the current flags to avoid redundant logging
    SELECT feature_flags INTO v_old_flags
    FROM organizations
    WHERE id = p_org_id;

    -- 3. If there's no change, exit early to reduce audit noise
    IF v_old_flags = v_new_flags THEN
        RETURN;
    END IF;

    -- 4. Perform the update
    UPDATE organizations
    SET feature_flags = v_new_flags,
        updated_at = now()
    WHERE id = p_org_id;

    -- 5. Record the audit event
    --    Uses the record_audit_event() helper from audit_log.sql
    v_audit_metadata := jsonb_build_object(
        'field', 'feature_flags',
        'old', v_old_flags,
        'new', v_new_flags
    );

    PERFORM record_audit_event(
        p_org_id,
        'settings.updated',
        'organizations',
        p_org_id,
        v_audit_metadata
    );

END;
$$;

-- 3. Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.update_org_feature_flags(UUID, JSONB) TO authenticated;

COMMIT;
