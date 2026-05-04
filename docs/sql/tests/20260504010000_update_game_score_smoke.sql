-- Smoke checks for 20260504010000_update_game_score_rpc.sql.

-- 1. Function exists, is SECURITY DEFINER, and pins search_path.
SELECT
    p.proname,
    pg_get_function_arguments(p.oid) AS args,
    p.prosecdef,
    p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'update_game_score';
-- Expected: 1 row; prosecdef = true; proconfig contains search_path=public.

-- 2. New audit action is accepted by the audit_log constraint.
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.audit_log'::regclass
  AND conname = 'audit_log_action_check';
-- Expected: definition includes competition.score_updated.

-- 3. Happy path outline. Replace placeholders with real org/game UUIDs.
--
-- SET LOCAL role = authenticated;
-- SET LOCAL "request.jwt.claims" = '{"sub":"<SCHEDULE_MANAGER_USER_UUID>"}';
-- SELECT public.update_game_score(
--   '<ORG_UUID>'::uuid,
--   '<GAME_UUID>'::uuid,
--   2,
--   1,
--   '{"source":"smoke"}'::jsonb
-- );
-- Expected: JSONB response with changed=true and one matching audit_log row.
