-- Revert for 20260614000000_advisor_hardening_followups.sql
--
-- Restores the pre-migration EXECUTE surface and default privileges. The
-- search_path pins are left in place deliberately — unpinning a definer
-- function's search_path is never an improvement; remove a pin manually with
-- `ALTER FUNCTION <sig> RESET search_path` only if a specific function needs
-- caller-controlled resolution (none do today). Run only to roll the
-- hardening back.

BEGIN;

-- Tier 1 — trigger / event-trigger functions: restore PUBLIC, anon, authenticated.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated', fn);
  END LOOP;
END
$$;

-- Tier 2 — other SECURITY DEFINER functions: restore PUBLIC + anon
-- (authenticated was never revoked). submit_registration is untouched either way.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prorettype NOT IN ('pg_catalog.trigger'::regtype, 'pg_catalog.event_trigger'::regtype)
      AND p.proname <> 'submit_registration'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon', fn);
  END LOOP;
END
$$;

-- Default privileges: restore Supabase's stock behavior (EXECUTE for PUBLIC,
-- anon, authenticated, service_role on future functions created by postgres).
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

COMMIT;
