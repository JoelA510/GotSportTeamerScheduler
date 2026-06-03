-- Revoke anon (and PUBLIC) EXECUTE on SECURITY DEFINER functions in `public`.
--
-- Context: the Supabase security advisor flags every SECURITY DEFINER function
-- the `anon` / `authenticated` roles can execute
-- (`anon_security_definer_function_executable` /
-- `authenticated_security_definer_function_executable`). New functions inherit
-- EXECUTE both from PostgreSQL's default PUBLIC grant and from Supabase's
-- default privileges (anon/authenticated/service_role), so admin RPCs that are
-- gated only by an internal `is_org_admin()` check remain directly invokable by
-- unauthenticated callers. This migration removes that unnecessary surface.
--
-- Policy applied (classification is by function property, NOT a hardcoded list,
-- so it stays correct across schema drift and future SECURITY DEFINER functions):
--   * Trigger functions (return type `trigger` / `event_trigger`) are invoked by
--     the trigger machinery as the table owner; no client role needs a direct
--     EXECUTE grant.  -> revoke from PUBLIC, anon, AND authenticated.
--   * Every other SECURITY DEFINER function (admin RPCs, RLS helpers such as
--     `is_org_admin` / `is_org_member`, internal helpers such as
--     `record_audit_event`) is called by logged-in admins via PostgREST and/or
--     referenced by RLS policies scoped to `authenticated`.
--     -> revoke from PUBLIC + anon; KEEP authenticated.
--   * `service_role` is never revoked: server-side / Edge Function paths that use
--     the service-role key keep working for every function.
--
-- Deliberately EXCLUDED (anon EXECUTE intentionally retained):
--   * public.submit_registration(...) — reached from the PUBLIC, unauthenticated
--     `/register/:formId` route (youth-sports registration forms are shared as
--     public links). Revoking anon here would break public registration.
--
-- Why a dynamic (property-based) revoke instead of an explicit signature list:
--   the live database carries legacy function overloads that the migration chain
--   has since dropped (e.g. a stale persist_evaluation_run(uuid,text,jsonb,integer)
--   overload removed by 20260504090000). A hardcoded
--   `REVOKE ... ON FUNCTION <sig>, <sig>, ...` list names every signature in one
--   statement, so a single missing overload aborts the whole statement with
--   42883 ("function does not exist") when replayed against a freshly-migrated
--   schema. Looping over pg_proc revokes from exactly the functions that exist in
--   whatever environment the migration runs in (clean CI build or live prod).
--
-- Why this is safe (verified by introspecting the live project mmwupqsjkikqzvmdvuzm):
--   * Every SECURITY DEFINER function in `public` has an EXPLICIT `authenticated`
--     EXECUTE grant (independent of the PUBLIC grant), so revoking PUBLIC + anon
--     leaves authenticated access intact for the Tier-2 set.
--   * `is_org_member` is referenced by 47 RLS policies and `is_org_admin` by 18,
--     ALL scoped to the `authenticated` role only — authenticated must keep
--     EXECUTE (preserved here) and anon never evaluates them via RLS.
--   * The only anon-reachable routes (/register, /invite, /organizations/new)
--     call solely submit_registration (excluded) and redeem_org_invite (the
--     invite flow redirects anon to Login before redeeming, and the function
--     requires auth.uid()), so no working anon flow loses access.
--
-- Reversible: see docs/sql/20260603120000_revert.sql.
-- Smoke checks: see docs/sql/20260603120000_smoke.sql.

BEGIN;

-- Tier 1 — trigger / event-trigger functions: no client role needs EXECUTE.
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
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn);
  END LOOP;
END
$$;

-- Tier 2 — all other SECURITY DEFINER functions: drop PUBLIC + anon, keep
-- authenticated. submit_registration is intentionally excluded.
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
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', fn);
  END LOOP;
END
$$;

COMMIT;
