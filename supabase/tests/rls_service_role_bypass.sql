-- RLS invariant: the `service_role` (used by Edge Functions running with
-- the service key) bypasses RLS and sees every row across every org.
--
-- This is the positive corollary to the org-isolation tests: Edge Functions
-- need unfettered access to do things like scheduled retention, calendar
-- token rotation, etc. If service_role were accidentally RLS-gated, every
-- background job would break.
--
-- Exercises: Postgres's default `BYPASSRLS` on `service_role`; no policy
-- should apply.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(1);

SET LOCAL role = 'service_role';

SELECT is(
    (SELECT COUNT(*) FROM public.teams)::int,
    2,
    'service_role sees teams from every org (A-Team + B-Team)'
);

SELECT * FROM finish();
ROLLBACK;
