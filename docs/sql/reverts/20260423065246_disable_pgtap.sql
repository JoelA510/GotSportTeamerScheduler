-- Wave 7a Task 1 revert: drop pgTAP extension.
--
-- Running this will also remove every pgTAP-provided function (plan, is,
-- isnt, finish, etc.). Safe to run in prod; no application code depends on
-- these functions — they exist purely for tests in supabase/tests/.
--
-- Forward: supabase/migrations/20260423065246_enable_pgtap.sql.

DROP EXTENSION IF EXISTS pgtap;
