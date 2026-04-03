-- Migration: Add Settings Audit Log RPC
-- Description: Adds a secure RPC for fetching settings and feature flag audit events.
-- Author: Antigravity

BEGIN;

-- 1. Update audit_log action constraint to include feature_flags.updated
DO $$
BEGIN
    ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
    
    ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check 
    CHECK (action IN (
        'import.started', 'import.completed', 'import.failed',
        'team.saved', 'team.deleted',
        'game.saved', 'game.deleted',
        'practice.saved', 'practice.deleted',
        'registration.submitted', 'registration.approved', 'registration.rejected',
        'calendar.token_rotated',
        'member.invited', 'member.removed', 'member.role_changed',
        'settings.updated',
        'feature_flags.updated',
        'export.started', 'export.completed'
    ));
END$$;

-- 2. Update update_org_feature_flags to use the specific feature_flags.updated action
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
    IF NOT is_org_admin(p_org_id) THEN
        RAISE EXCEPTION 'Unauthorized: You must be an organization administrator to update feature flags.';
    END IF;

    SELECT feature_flags INTO v_old_flags
    FROM organizations
    WHERE id = p_org_id;

    IF v_old_flags = v_new_flags THEN
        RETURN;
    END IF;

    UPDATE organizations
    SET feature_flags = v_new_flags,
        updated_at = now()
    WHERE id = p_org_id;

    v_audit_metadata := jsonb_build_object(
        'field', 'feature_flags',
        'old', v_old_flags,
        'new', v_new_flags
    );

    PERFORM record_audit_event(
        p_org_id,
        'feature_flags.updated',
        'organizations',
        p_org_id,
        v_audit_metadata
    );
END;
$$;

/**
 * Fetches settings and feature flag audit events for a specific organization.
 * 
 * @param p_organization_id The UUID of the organization to fetch logs for.
 * @returns A table containing audit log entries with actor details.
 * 
 * Security: Limited to organization administrators via is_org_admin().
 */
CREATE OR REPLACE FUNCTION public.get_settings_audit_log(p_organization_id UUID)
RETURNS TABLE (
    id UUID,
    created_at TIMESTAMPTZ,
    action TEXT,
    resource_type TEXT,
    resource_id UUID,
    metadata JSONB,
    actor_name TEXT,
    actor_email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Check if calling user is an admin of the org
    IF NOT is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied. Organization admin role required.';
    END IF;

    RETURN QUERY
    SELECT 
        a.id,
        a.created_at,
        a.action,
        a.resource_type,
        a.resource_id,
        a.metadata,
        COALESCE(p.full_name, 'Unknown User') as actor_name,
        p.email as actor_email
    FROM public.audit_log a
    LEFT JOIN public.profiles p ON a.user_id = p.id
    WHERE a.organization_id = p_organization_id
      AND a.action IN ('settings.updated', 'feature_flags.updated')
    ORDER BY a.created_at DESC;
END;
$$;

-- Grant execution permission to authenticated users
GRANT EXECUTE ON FUNCTION public.get_settings_audit_log(UUID) TO authenticated;

COMMIT;
