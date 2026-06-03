-- Revert for 20260603120000_revoke_anon_execute_on_definer_functions.sql
--
-- Re-opens the EXECUTE surface the forward migration closed: re-grants PUBLIC +
-- anon on every SECURITY DEFINER function in `public`, plus authenticated on the
-- trigger functions. Mirrors the forward migration's property-based classification
-- (loop over pg_proc) so it stays correct across schema drift instead of naming a
-- brittle, hardcoded signature list. `service_role` and the function owner are
-- unaffected (never revoked). Run only to roll the hardening back.

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

-- Tier 2 — all other SECURITY DEFINER functions: restore PUBLIC + anon
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

COMMIT;
