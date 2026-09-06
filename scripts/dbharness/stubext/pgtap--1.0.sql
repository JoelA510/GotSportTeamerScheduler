-- Harness stub for pgTAP. Deliberately EMPTY of assertion functions: the
-- harness must not appear to run the pgTAP suite. If a migration ever calls a
-- pgTAP assertion, it will fail loudly here rather than pass against a stub
-- that answers "ok" to everything.
SELECT 1;
