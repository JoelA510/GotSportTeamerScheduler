-- Smoke checks for 20260503050000_coach_admin_mutations.sql.

-- 1. Functions exist, are SECURITY DEFINER, and pin search_path.
SELECT
    p.proname,
    pg_get_function_arguments(p.oid) AS args,
    p.prosecdef,
    p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('admin_update_coach_status', 'admin_assign_team_coach')
ORDER BY p.proname;
-- Expected: 2 rows; prosecdef = true; proconfig contains search_path=public.

-- 2. New audit actions are accepted by the audit_log constraint.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.audit_log'::regclass
  AND conname = 'audit_log_action_check';
-- Expected: definition includes coach.status_updated, coach.promoted,
-- team.coach_assigned, team.coach_swapped, and team.coach_unassigned.

-- 3. Happy path outline. Replace placeholders with real org/team/coach UUIDs.
--
-- SET LOCAL role = authenticated;
-- SET LOCAL "request.jwt.claims" = '{"sub":"<ORG_ADMIN_USER_UUID>"}';
-- SELECT public.admin_update_coach_status(
--   '<ORG_UUID>'::uuid,
--   '<COACH_UUID>'::uuid,
--   'active'
-- );
-- SELECT public.admin_assign_team_coach(
--   '<ORG_UUID>'::uuid,
--   '<TEAM_UUID>'::uuid,
--   '<COACH_UUID>'::uuid
-- );
-- Expected: JSONB responses with changed=true and matching audit_log rows.
