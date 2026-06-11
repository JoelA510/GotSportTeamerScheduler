-- Harden 20260612000000_min_uuid_aggregate:
--
-- 1. STRICT: Postgres's aggregate executor skips the SFUNC call when either
--    arg is NULL and initialises the running state from the first non-NULL
--    input directly — the standard pattern for min/max SFUNCs.
-- 2. GRANT EXECUTE on the transition function to authenticated + service_role:
--    while the three call-sites are all SECURITY DEFINER (and run as the
--    function owner), any future SECURITY INVOKER path or direct query by an
--    authenticated user would hit "permission denied for function min_uuid"
--    without this grant.

CREATE OR REPLACE FUNCTION public.min_uuid(uuid, uuid)
RETURNS uuid
LANGUAGE sql
IMMUTABLE STRICT PARALLEL SAFE
SET search_path = public
AS $$ SELECT LEAST($1, $2); $$;

REVOKE EXECUTE ON FUNCTION public.min_uuid(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.min_uuid(uuid, uuid) TO authenticated, service_role;
