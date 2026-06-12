-- Advisor hardening follow-ups (security advisor sweep, 2026-06-12).
--
-- The 20260603120000 revoke and the 20260421* search_path migrations cleared
-- the advisor board, but every function created since (the CRUD RPC wave,
-- import helpers, sync triggers) re-inherited anon EXECUTE from PostgreSQL's
-- default PUBLIC grant + Supabase's default privileges, and several shipped
-- without a pinned search_path. This migration:
--
--   1. Pins `search_path = public` on the 16 flagged functions that can carry
--      one. (`min(uuid)` is also flagged but is an aggregate over the already
--      pinned `min_uuid` SFUNC — aggregates cannot carry SET clauses, and the
--      internal-language aggregate has no SQL body to hijack. Accepted.)
--   2. Re-runs the property-based anon/PUBLIC revoke from 20260603120000
--      (trigger functions lose all client EXECUTE; other SECURITY DEFINER
--      functions lose PUBLIC + anon, keep authenticated; submit_registration
--      stays anon-executable for the public /register/:formId route).
--   3. Stops the drift recurring: default privileges for functions created by
--      `postgres` in `public` now exclude PUBLIC and anon, and explicitly
--      include authenticated + service_role (the status quo every existing
--      RPC already relies on). A future intentionally-public function must
--      say so with an explicit `GRANT EXECUTE ... TO anon`.
--
-- Both sweeps are property-based loops over pg_proc (not hardcoded signature
-- lists) for the same replay-safety reasons documented in 20260603120000.
--
-- Reversible: see docs/sql/20260614000000_revert.sql.
-- Smoke checks: see docs/sql/20260614000000_smoke.sql.

BEGIN;

-- 1. Pin search_path on flagged functions that currently lack one. prokind='f'
--    keeps aggregates (min) out; the name filter keeps extension functions out.
DO $$
DECLARE
  fn regprocedure;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN (
        'handle_field_subunits',
        'import_normalize_capacity_basis',
        'import_normalize_field_availability_approval_status',
        'import_normalize_field_availability_record_status',
        'import_normalize_format_code',
        'import_normalize_requirement_status',
        'import_payload_text',
        'import_text_to_bool',
        'import_text_to_date',
        'import_text_to_day_of_week',
        'import_text_to_jsonb_array',
        'import_text_to_positive_int',
        'import_text_to_time',
        'persist_evaluation_run',
        'prune_old_evaluation_runs',
        'set_created_by_to_auth_uid'
      )
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg
        WHERE cfg LIKE 'search_path=%'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public', fn);
  END LOOP;
END
$$;

-- 2a. Trigger / event-trigger SECURITY DEFINER functions: no client role needs
--     direct EXECUTE (the trigger machinery invokes them as the table owner).
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

-- 2b. All other SECURITY DEFINER functions: drop PUBLIC + anon, keep
--     authenticated. submit_registration is intentionally excluded (public
--     registration links).
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

-- 3. Future functions created by postgres in `public` no longer inherit
--    EXECUTE for PUBLIC/anon; authenticated + service_role keep the grant
--    every existing RPC already depends on.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO authenticated, service_role;

COMMIT;
