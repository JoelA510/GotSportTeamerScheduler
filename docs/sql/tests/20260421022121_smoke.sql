-- Smoke test for migration 20260421022121_auto_create_profile_on_signup.sql
--
-- Manual operator verification — run in order against staging or prod.

-- 1. Trigger exists on auth.users, fires on INSERT OR UPDATE of mirrored cols.
SELECT
  tgname AS trigger_name,
  tgrelid::regclass AS table_name,
  tgenabled AS enabled_state,
  pg_get_triggerdef(oid) AS definition
FROM pg_trigger
WHERE tgname = 'on_auth_user_created';
-- Expected: 1 row with table_name = 'auth.users', enabled_state = 'O' (origin),
-- and the definition references INSERT OR UPDATE OF email, raw_user_meta_data.

-- 2. Trigger function exists with pinned search_path.
SELECT
  proname,
  proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'handle_new_user';
-- Expected: 1 row; proconfig contains 'search_path=public'.

-- 3. profiles.email is nullable (supports phone / social signups).
SELECT is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'email';
-- Expected: 'YES'.

-- 4. Backfill worked: every auth.users has a matching profiles row.
SELECT COUNT(*) AS orphan_auth_users
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL;
-- Expected: 0.

-- 5. Update-propagation smoke: change an auth.users email and confirm the
--    trigger's ON CONFLICT DO UPDATE branch syncs profiles. Pick a test user
--    you control (or the current user); this is safe — it only mutates your
--    own row.
--
--    As the SERVICE ROLE (dashboard SQL editor runs as this by default):
--      UPDATE auth.users
--      SET email = 'smoke-update-' || extract(epoch from now())::bigint || '@example.com'
--      WHERE id = '<your-user-uuid>';
--
--      SELECT email, updated_at
--      FROM public.profiles
--      WHERE id = '<your-user-uuid>';
--    Expected: email matches the new value, updated_at is within the last
--    few seconds.

-- 6. End-to-end: register a fresh test user, then confirm the wizard insert
--    no longer FK-fails.
--      supabase auth signup --email smoke+$(date +%s)@example.com --password 'smoke-pass-1234'
--      (Then, as that user's session:)
--      SELECT public.initialize_new_tenant(
--        'Smoke Org', 'smoke-org-' || gen_random_uuid(), 'America/New_York', 2026
--      );
--    Expected: returns a UUID (the new org_id). If FK violation on
--    organization_members_profile_id_fkey, the trigger did NOT fire (check
--    tgenabled in step 1).

-- 7. Orphan check (belt-and-suspenders).
SELECT u.id, u.email
FROM auth.users u
LEFT JOIN public.profiles p ON p.id = u.id
WHERE p.id IS NULL
ORDER BY u.created_at DESC
LIMIT 10;
-- Expected: 0 rows.
