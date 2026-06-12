-- Smoke test for 20260613000006_audit_actions_lookup.sql

-- Lookup table exists with RLS enabled
SELECT relname, relrowsecurity
FROM pg_class
WHERE relname = 'audit_actions' AND relnamespace = 'public'::regnamespace;
-- Expected: 1 row, relrowsecurity = true

-- Old CHECK constraint is gone, FK is in place
SELECT conname, contype
FROM pg_constraint
WHERE conrelid = 'public.audit_log'::regclass
  AND conname IN ('audit_log_action_check', 'audit_log_action_fkey');
-- Expected: only audit_log_action_fkey (contype 'f')

-- Registry is populated and covers every action already in audit_log
SELECT count(*) AS registered_actions FROM public.audit_actions;
-- Expected: >= 61

SELECT DISTINCT al.action
FROM public.audit_log al
LEFT JOIN public.audit_actions aa ON aa.action = al.action
WHERE aa.action IS NULL;
-- Expected: 0 rows (no orphaned actions)

-- Unregistered actions are rejected (expect ERROR 23503)
-- INSERT INTO public.audit_log (organization_id, action)
-- VALUES ('00000000-0000-0000-0000-000000000000', 'bogus.action');
