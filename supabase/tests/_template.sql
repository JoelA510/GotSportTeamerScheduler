-- pgTAP test template — copy this file to start a new test.
--
-- Conventions:
-- * Filename: snake_case, descriptive, <area>_<invariant>.sql
--   e.g. `rls_cross_org_isolation.sql`, `trigger_audit_log_append_only.sql`.
-- * Wrap the whole body in BEGIN ... ROLLBACK so the DB state is unchanged
--   after the test runs — pgTAP tests must be idempotent.
-- * Include shared fixtures with `\i supabase/tests/_fixtures.sql` where
--   possible. Per-test INSERTs are discouraged; extend `_fixtures.sql` if
--   you need new seed data.
-- * Simulate a user with `SET LOCAL role = 'authenticated'` +
--   `SET LOCAL "request.jwt.claims" TO '{"sub":"<uuid>"}'` — this is what
--   Supabase's RLS helpers (`auth.uid()`, `is_org_member()`, etc.) read.
-- * Declare `SELECT plan(N)` with the exact number of assertions you make.
--   Too many / too few asserts -> test fails.
-- * Always finish with `SELECT finish();` before `ROLLBACK;`.
--
-- Useful assertion helpers (all pgTAP):
--   is(actual, expected, description)         — equality
--   isnt(actual, expected, description)       — inequality
--   ok(condition, description)                — truthy
--   results_eq(query, expected, description)  — row-set equality
--   throws_ok(query, error_code, description) — error assertion
--
-- Run locally:
--   supabase start
--   npm run test:db
--   supabase stop
--
-- Run a single file:
--   npm run test:db:once supabase/tests/<file>.sql

BEGIN;

-- Include shared fixtures (Alice/Bob/Charlie + Org A/B + A-Team/B-Team).
\i supabase/tests/_fixtures.sql

-- Declare the number of assertions this test will make.
SELECT plan(1);

-- Simulate an authenticated user (optional — omit for anon/service_role tests).
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

-- Your assertions go here.
SELECT ok(true, 'template placeholder — replace with real assertion');

SELECT * FROM finish();
ROLLBACK;
