-- Phase 4 (4.6): Audit Logging Infrastructure
-- Append-only audit_log table for tracking admin actions.
-- All writes go through the SECURITY DEFINER record_audit_event() RPC.
-- No direct INSERT/UPDATE/DELETE policies — the table is immutable via RLS.

BEGIN;

-- 1. Create the audit_log table
CREATE TABLE IF NOT EXISTS public.audit_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id         UUID NOT NULL REFERENCES auth.users(id),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    action          TEXT NOT NULL CHECK (action IN (
        'import.started', 'import.completed', 'import.failed',
        'team.saved', 'team.deleted',
        'game.saved', 'game.deleted',
        'practice.saved', 'practice.deleted',
        'registration.submitted', 'registration.approved', 'registration.rejected',
        'calendar.token_rotated',
        'member.invited', 'member.removed', 'member.role_changed',
        'settings.updated',
        'export.started', 'export.completed'
    )),
    resource_type   TEXT,
    resource_id     UUID,
    metadata        JSONB DEFAULT '{}'::jsonb,
    ip_address      INET
);

-- 2. Indexes for efficient org-scoped and user-scoped queries
CREATE INDEX IF NOT EXISTS idx_audit_log_org_created
    ON public.audit_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_created
    ON public.audit_log (user_id, created_at DESC);

-- 3. Enable RLS
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- 4. SELECT only: org admins can read their org's logs
CREATE POLICY "Admins can view org audit logs"
    ON public.audit_log FOR SELECT TO authenticated
    USING (
        is_org_member(organization_id)
        AND EXISTS (
            SELECT 1 FROM public.organization_members
            WHERE organization_members.profile_id = auth.uid()
              AND organization_members.organization_id = audit_log.organization_id
              AND organization_members.role = 'admin'
        )
    );

-- No INSERT/UPDATE/DELETE policies for the authenticated role.
-- All writes go through the SECURITY DEFINER RPC below.

-- 5. Helper RPC for recording audit events
--    Called by Edge Functions and other RPCs. Uses auth.uid() so
--    the calling user's identity is automatically captured.
CREATE OR REPLACE FUNCTION public.record_audit_event(
    p_organization_id UUID,
    p_action TEXT,
    p_resource_type TEXT DEFAULT NULL,
    p_resource_id UUID DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb,
    p_ip_address INET DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_audit_id UUID;
BEGIN
    INSERT INTO public.audit_log (
        user_id, organization_id, action,
        resource_type, resource_id, metadata, ip_address
    )
    VALUES (
        auth.uid(), p_organization_id, p_action,
        p_resource_type, p_resource_id, p_metadata, p_ip_address
    )
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_audit_event(UUID, TEXT, TEXT, UUID, JSONB, INET)
    TO authenticated;

COMMIT;
