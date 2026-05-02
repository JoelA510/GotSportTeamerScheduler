-- RLS invariant: a member of Org A cannot SELECT Org B's rows.
--
-- This is the bedrock multi-tenancy guarantee. If this test fails, any
-- authenticated user can read another organization's teams, players, or
-- imports — the platform's whole tenancy model is compromised.
--
-- Exercises: `teams` RLS policy (unified org access via is_org_member).

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(3);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (SELECT COUNT(*) FROM public.teams)::int,
    1,
    'Alice (Org A admin) sees only her org''s teams'
);

SELECT is(
    (SELECT name FROM public.teams LIMIT 1),
    'A-Team',
    'the team Alice sees is A-Team (Org A)'
);

SELECT is(
    (SELECT COUNT(*) FROM public.teams
       WHERE organization_id = 'b2222222-2222-2222-2222-222222222222')::int,
    0,
    'explicit Org B filter returns zero rows for Alice'
);

SELECT * FROM finish();
ROLLBACK;
