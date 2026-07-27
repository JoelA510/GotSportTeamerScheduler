-- Add authorization checks to record_audit_event, the sole write path into
-- audit_log.
--
-- record_audit_event (originally 20260324000004_audit_log.sql, most recently
-- redefined in 20260331000000_definitive_schema.sql:915-946) is SECURITY
-- DEFINER, granted to `authenticated`, and inserted a row using auth.uid()
-- for user_id -- but never checked that the caller is actually a member of
-- p_organization_id, or that an admin-only action (impersonation) was
-- performed by an admin. It is called directly from client code in 12+
-- places (AuthContext.jsx, useCoedTransition.js, TeamBuilderPage.jsx,
-- FeatureFlagSettings.jsx, AccountModule.jsx, SeasonModule.jsx). Any
-- authenticated user could call
-- `supabase.rpc('record_audit_event', { p_organization_id: '<any org>', ... })`
-- from devtools and write a permanent, convincing fake entry into a
-- DIFFERENT organization's append-only compliance history -- a direct
-- breach of governance mandate #4 (audit immutability), exploitable today
-- with no privilege beyond a valid login.
--
-- This migration (1) requires the caller to be a member of p_organization_id
-- for every audit write, and (2) additionally requires org-admin membership
-- for the impersonation.* actions, since AuthContext.jsx:192's
-- `user?.profile?.role !== 'admin'` check that gates impersonateUser() today
-- is client-only with no server-side backstop (governance mandate #6 --
-- "session integrity, UI gating never the only gate").
--
-- service_role callers are exempt from both checks. supabase/functions/
-- _shared/auth.ts's recordAudit() helper calls this RPC via a service-role
-- client (e.g. team-persistence/index.ts:272 -- created from the service key
-- with no end-user Authorization header forwarded), so auth.uid() is NULL
-- and is_org_member() would always be false for that caller. This mirrors
-- the established v_effective_role <> 'service_role' exemption pattern in
-- 20260503010000_repair_practice_persistence_rpc.sql and
-- 20260503040000_repair_team_persistence_rpc.sql; service_role is only
-- reachable with the secret service-role key (never shipped to the browser),
-- so trusting it here does not reopen the client-exploitable gap this
-- migration closes.
--
-- KNOWN PRE-EXISTING DEFECT (not introduced or fixed here): that exemption
-- is currently moot in practice. audit_log.user_id is
-- `NOT NULL REFERENCES auth.users(id)` (20260324000004_audit_log.sql:12),
-- and a service-role JWT carries no `sub` claim, so the INSERT below fails
-- with 23502 for every Edge-Function-initiated audit write -- and always
-- has, silently, because recordAudit() is fire-and-forget and swallows the
-- error into a console.error (_shared/auth.ts:149-159). In other words all
-- nine Edge Function recordAudit() call sites are no-ops today. The
-- exemption is kept because it is correct on its own terms and becomes
-- load-bearing the moment that defect is fixed (nullable user_id or a
-- system-actor sentinel row). Pinned by
-- supabase/tests/rls_record_audit_event_authz.sql test 6, which asserts
-- 23502 rather than 42501 -- proving the guard is skipped for service_role.
--
-- Function signature is unchanged, so no call-site changes are needed.
--
-- Reversible: see docs/sql/20260726000200_revert.sql.
-- Smoke checks: see docs/sql/20260726000200_smoke.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.record_audit_event(
    p_organization_id uuid,
    p_action text,
    p_resource_type text DEFAULT NULL,
    p_resource_id uuid DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'::jsonb,
    p_ip_address inet DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_audit_id uuid;
    v_effective_role text := COALESCE(auth.role(), current_role, '');
BEGIN
    IF v_effective_role <> 'service_role'
       AND NOT public.is_org_member(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not a member of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF v_effective_role <> 'service_role'
       AND p_action IN ('impersonation.started', 'impersonation.ended')
       AND NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: % requires admin membership in organization %', p_action, p_organization_id
            USING ERRCODE = '42501';
    END IF;

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

GRANT EXECUTE ON FUNCTION public.record_audit_event(uuid, text, text, uuid, jsonb, inet)
    TO authenticated;

COMMIT;
