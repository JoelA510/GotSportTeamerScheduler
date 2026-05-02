-- Phase 2: Setup Wizard, Telemetry & RBAC Hardening
-- Adds is_onboarded column, creates telemetry_log, and expands RBAC for tenant_admin.

BEGIN;

-- 1. Support the new 'tenant_admin' role across the system
--    We need to update the role check constraint on organization_members.
--    Postgres anonymous constraints are usually <table>_<column>_check.
ALTER TABLE public.organization_members DROP CONSTRAINT IF EXISTS organization_members_role_check;
ALTER TABLE public.organization_members ADD CONSTRAINT organization_members_role_check 
    CHECK (role IN ('admin', 'coach', 'player', 'parent', 'staff', 'tenant_admin'));

-- 2. Update the audit_log action constraint to include onboarding events
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
        'export.started', 'export.completed',
        'organization.onboarded' -- New action for Phase 2
    ));

-- 3. Redefine is_org_admin() to include tenant_admin
--    This ensures existing RPCs (feature flags, settings) work for organization owners.
DROP FUNCTION IF EXISTS public.is_org_admin(UUID);

CREATE OR REPLACE FUNCTION public.is_org_admin(p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM public.organization_members 
        WHERE organization_id = p_org_id 
          AND profile_id = auth.uid() 
          AND role IN ('admin', 'tenant_admin')
    );
END;
$$;

-- 4. Add onboarding status to organizations
ALTER TABLE public.organizations 
ADD COLUMN IF NOT EXISTS is_onboarded BOOLEAN NOT NULL DEFAULT FALSE;

-- 5. Create telemetry_log table for onboarding and ingestion tracking
CREATE TABLE IF NOT EXISTS public.telemetry_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id      UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    session_id  TEXT NOT NULL,
    event_type  TEXT NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_by  UUID REFERENCES auth.users(id)
);

-- 6. Enable RLS on telemetry_log
ALTER TABLE public.telemetry_log ENABLE ROW LEVEL SECURITY;

-- 7. Policies for telemetry_log
--    Only organization members can insert telemetry (Fixed profile_id reference)
CREATE POLICY "Insert telemetry for own organization"
ON public.telemetry_log
FOR INSERT
TO authenticated
WITH CHECK (
    org_id IN (
        SELECT organization_id 
        FROM public.organization_members 
        WHERE profile_id = auth.uid()
    )
);

--    Only organization admins (including tenant_admin) can view telemetry
CREATE POLICY "View telemetry for own organization"
ON public.telemetry_log
FOR SELECT
TO authenticated
USING (
    org_id IN (
        SELECT organization_id 
        FROM public.organization_members 
        WHERE profile_id = auth.uid() 
          AND role IN ('admin', 'tenant_admin')
    )
);

-- 8. Create a high-integrity function to finalize onboarding
--    Atomicsally updates flags, sets onboarded status, and records audit log.
CREATE OR REPLACE FUNCTION public.finalize_onboarding(
    p_org_id UUID,
    p_flags JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Only admins/tenant_admins can call this
    IF NOT is_org_admin(p_org_id) THEN
        RAISE EXCEPTION 'Unauthorized: You must be an organization administrator to finalize onboarding.';
    END IF;

    -- Update flags and marking as onboarded
    UPDATE public.organizations
    SET feature_flags = COALESCE(p_flags, feature_flags),
        is_onboarded = TRUE,
        updated_at = now()
    WHERE id = p_org_id;

    -- Record the permanent audit event
    PERFORM public.record_audit_event(
        p_org_id,
        'organization.onboarded',
        'organizations',
        p_org_id,
        jsonb_build_object('feature_flags', p_flags)
    );

END;
$$;

-- 9. Grant necessary permissions
GRANT EXECUTE ON FUNCTION public.finalize_onboarding(UUID, JSONB) TO authenticated;

COMMIT;
