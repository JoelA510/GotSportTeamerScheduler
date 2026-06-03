-- pgTAP: SECURITY DEFINER function EXECUTE grants are hardened against anon.
--
-- Asserts the end state of
-- supabase/migrations/20260603120000_revoke_anon_execute_on_definer_functions.sql:
--   * anon cannot execute admin RPCs, RLS helpers, or trigger functions;
--   * authenticated keeps admin RPCs + RLS helpers but loses trigger functions;
--   * anon retains the intentionally-excluded public registration RPC.
-- Grant checks need no fixtures, so this suite seeds nothing.

BEGIN;

SELECT plan(8);

-- anon EXECUTE is revoked across admin RPCs, RLS helpers and trigger functions.
SELECT ok(
  NOT has_function_privilege('anon', 'public.admin_select_field_availability_scenario(uuid,text,text,uuid)', 'EXECUTE'),
  'anon cannot execute admin_select_field_availability_scenario'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.create_import_job(uuid,text,text)', 'EXECUTE'),
  'anon cannot execute create_import_job'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.is_org_admin(uuid)', 'EXECUTE'),
  'anon cannot execute is_org_admin (RLS helper)'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.handle_new_user()', 'EXECUTE'),
  'anon cannot execute trigger fn handle_new_user'
);

-- authenticated keeps RLS helpers and admin RPCs (no behavior change for admins).
SELECT ok(
  has_function_privilege('authenticated', 'public.is_org_member(uuid)', 'EXECUTE'),
  'authenticated retains is_org_member (referenced by RLS policies)'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.admin_select_field_availability_scenario(uuid,text,text,uuid)', 'EXECUTE'),
  'authenticated retains admin_select_field_availability_scenario'
);

-- Trigger functions need no direct grant, so authenticated loses EXECUTE too.
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.handle_new_user()', 'EXECUTE'),
  'authenticated cannot execute trigger fn handle_new_user'
);

-- Intentional exclusion: the public /register route runs submit_registration as anon.
SELECT ok(
  has_function_privilege('anon', 'public.submit_registration(uuid,uuid,uuid,jsonb,uuid,text,text)', 'EXECUTE'),
  'anon retains submit_registration (public registration route)'
);

SELECT * FROM finish();

ROLLBACK;
