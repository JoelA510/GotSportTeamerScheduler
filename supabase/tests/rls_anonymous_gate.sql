-- RLS invariant: the `anon` role (unauthenticated API callers) cannot read
-- any domain rows. If anon ever returns a non-zero count from these tables,
-- a public API endpoint is leaking data.
--
-- Exercises: default-deny RLS on organizations, teams, players, audit_log,
-- and organization_members — all of which should require `authenticated`
-- and pass an is_org_member() / is_org_admin() check.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(5);

SET LOCAL role = 'anon';

SELECT is(
    (SELECT COUNT(*) FROM public.organizations)::int,
    0,
    'anon: organizations returns 0 rows'
);

SELECT is(
    (SELECT COUNT(*) FROM public.teams)::int,
    0,
    'anon: teams returns 0 rows'
);

SELECT is(
    (SELECT COUNT(*) FROM public.players)::int,
    0,
    'anon: players returns 0 rows'
);

SELECT is(
    (SELECT COUNT(*) FROM public.audit_log)::int,
    0,
    'anon: audit_log returns 0 rows'
);

SELECT is(
    (SELECT COUNT(*) FROM public.organization_members)::int,
    0,
    'anon: organization_members returns 0 rows'
);

SELECT * FROM finish();
ROLLBACK;
