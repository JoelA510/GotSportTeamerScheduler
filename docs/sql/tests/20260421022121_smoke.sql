-- Smoke test for migration 20260421022121_auto_create_profile_on_signup.sql
--
-- Manual operator verification — run in order against staging or prod.

-- 1. Trigger exists on auth.users.
SELECT
  tgname AS trigger_name,
  tgrelid::regclass AS table_name,
  tgenabled AS enabled_state
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';
-- Expected: 1 row with table_name = 'auth.users', enabled_state = 'O' (origin).

-- 2. Trigger function exists with pinned search_path.
SELECT
  proname,
  proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
-- Expected: 1 row; proconfig contains 'search_path=public'.

-- 3. Backfill worked: every auth.users has a matching profiles row.
SELECT COUNT(*) AS orphan_auth_users
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
-- Expected: 0.

-- 4. End-to-end smoke: register a fresh test user, then confirm the wizard
--    insert no longer FK-fails.
--    Run manually:
--      supabase auth signup --email smoke+$(date +%s)@example.com --password 'smoke-pass-1234'
--      Then in the Supabase SQL editor (as that user's session):
--        SELECT public.initialize_new_tenant(
--          'Smoke Org', 'smoke-org-' || gen_random_uuid(), 'America/New_York', 2026
--        );
--    Expected: returns a UUID (the new org_id). If FK violation on
--    organization_members_profile_id_fkey, the trigger did NOT fire (check
--    tgenabled in step 1).

-- 5. Orphan check (belt-and-suspenders).
SELECT u.id, u.email
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at DESC
LIMIT 10;
-- Expected: 0 rows.
