-- 20260404110000_telemetry_rpc.sql
-- Implements high-integrity telemetry write-back with strict RBAC.

BEGIN;

/**
 * public.log_telemetry_event
 * 
 * Securely logs telemetry events with organization scoping.
 * 
 * @param p_org_id      The organization ID associated with the event.
 * @param p_event_name  The name of the event (e.g., 'import.suggestions_applied').
 * @param p_payload     The detailed event payload.
 */
CREATE OR REPLACE FUNCTION public.log_telemetry_event(
    p_org_id UUID,
    p_event_name TEXT,
    p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_telemetry_id UUID;
BEGIN
    -- 1. Validate Organization Membership
    --    Uses the foundational is_org_member function which checks auth.uid().
    IF NOT public.is_org_member(p_org_id) THEN
        RAISE EXCEPTION 'Access denied: User is not a member of organization %', p_org_id;
    END IF;

    -- 2. Insert Telemetry Record
    --    session_id is extracted from payload or defaulted to 'N/A'
    --    created_by is automatically bound to auth.uid()
    INSERT INTO public.telemetry_log (
        org_id,
        session_id,
        event_type,
        payload,
        created_by
    )
    VALUES (
        p_org_id,
        COALESCE(p_payload->>'session_id', 'N/A'),
        p_event_name,
        p_payload,
        auth.uid()
    )
    RETURNING id INTO v_telemetry_id;

    -- 3. Return the new event ID
    RETURN v_telemetry_id;
END;
$$;

-- 4. Grant execution permissions to authenticated users
GRANT EXECUTE ON FUNCTION public.log_telemetry_event(UUID, TEXT, JSONB) TO authenticated;

COMMIT;
