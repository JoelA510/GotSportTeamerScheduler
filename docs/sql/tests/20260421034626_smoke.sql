-- Smoke test for migration 20260421034626_invite_code_system.sql
--
-- Intended to run in the Supabase SQL editor (which connects as service_role).

-- 1. Table + RLS posture.
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relname = 'organization_invites';
-- Expected: 1 row; relrowsecurity = true.

-- 2. Policies exist (view + delete only; INSERT/UPDATE go through RPCs).
SELECT polname
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'organization_invites'
ORDER BY polname;
-- Expected rows:
--   Invites: admins delete unused
--   Invites: admins view own org

-- 3. Functions with pinned search_path (advisor-lint §1).
SELECT proname, prosecdef, proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('generate_invite_code', 'create_org_invite', 'redeem_org_invite');
-- Expected: 3 rows; each proconfig contains 'search_path=public';
-- prosecdef=true for create_org_invite + redeem_org_invite;
-- prosecdef=false for generate_invite_code (helper only).

-- 4. generate_invite_code() shape: 9 chars, matches XXXX-XXXX regex.
SELECT public.generate_invite_code() AS sample;
-- Expected: a string like 'A3KQ-7PLM' — 4 chars, hyphen, 4 chars.
-- Re-run 5 times; distribution should look random.

-- 5. End-to-end smoke:
--    Replace <ADMIN_UUID> with a profile_id that is an admin of <ORG_UUID>.
--    Replace <JOINER_UUID> with any OTHER profile_id.
--
--    SET LOCAL ROLE authenticated;
--    SET LOCAL "request.jwt.claims" = '{"sub": "<ADMIN_UUID>"}';
--    SELECT * FROM public.create_org_invite('<ORG_UUID>', 'coach');
--    -- Grab the code, e.g. 'A3KQ-7PLM'.
--
--    SET LOCAL "request.jwt.claims" = '{"sub": "<JOINER_UUID>"}';
--    SELECT public.redeem_org_invite('a3kq-7plm');    -- lowercase OK
--    -- Returns: <ORG_UUID>.
--
--    Re-redeem should fail:
--    SELECT public.redeem_org_invite('a3kq-7plm');
--    -- ERROR: Invite code has already been used
--
--    Non-admin creating should fail:
--    SET LOCAL "request.jwt.claims" = '{"sub": "<JOINER_UUID>"}';
--    SELECT * FROM public.create_org_invite('<ORG_UUID>', 'coach');
--    -- ERROR: Not authorized to create invites for this organization
