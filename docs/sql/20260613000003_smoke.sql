-- Smoke test for 20260613000003_schedule_team_delete_rpcs.sql
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name IN (
    'admin_cancel_game_assignment',
    'admin_cancel_practice_assignment',
    'admin_delete_team'
  );
-- Expected: 3 rows

SELECT proname, prosecdef
FROM pg_proc
JOIN pg_namespace ON pg_namespace.oid = pg_proc.pronamespace
WHERE pg_namespace.nspname = 'public'
  AND proname IN (
    'admin_cancel_game_assignment',
    'admin_cancel_practice_assignment',
    'admin_delete_team'
  );
-- Expected: all prosecdef = true

-- Verify audit actions
SELECT pg_get_constraintdef(oid) AS constraint_def
FROM pg_constraint
WHERE conname = 'audit_log_action_check';
-- Expected: definition contains 'game.cancelled', 'practice.cancelled'
