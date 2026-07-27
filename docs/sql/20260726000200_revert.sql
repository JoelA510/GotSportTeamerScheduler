-- Revert for 20260726000200_record_audit_event_authz.sql
--
-- Restores record_audit_event to its unauthorized-write state (originally
-- 20260331000000_definitive_schema.sql:915-946). Run only to roll the
-- hardening back -- this reopens the cross-org audit-log fabrication path
-- the migration closes.

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

GRANT EXECUTE ON FUNCTION public.record_audit_event(uuid, text, text, uuid, jsonb, inet)
    TO authenticated;

COMMIT;
