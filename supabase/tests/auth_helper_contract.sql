-- pgTAP: legacy role helper is absent; org-scoped auth helpers remain.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(7);

SELECT ok(
    to_regprocedure('public.current_user_role()') IS NULL,
    'legacy current_user_role helper is absent'
);

SELECT ok(
    to_regprocedure('public.is_org_member(uuid)') IS NOT NULL,
    'is_org_member helper remains installed'
);

SELECT ok(
    to_regprocedure('public.is_org_admin(uuid)') IS NOT NULL,
    'is_org_admin helper remains installed'
);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    public.is_org_member('a1111111-1111-1111-1111-111111111111'),
    true,
    'Org A admin is an Org A member'
);

SELECT is(
    public.is_org_member('b2222222-2222-2222-2222-222222222222'),
    false,
    'Org A admin is not an Org B member'
);

SELECT is(
    public.is_org_admin('a1111111-1111-1111-1111-111111111111'),
    true,
    'Org A admin is an Org A admin'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';

SELECT is(
    public.is_org_admin('a1111111-1111-1111-1111-111111111111'),
    false,
    'Org A coach is not an Org A admin'
);

SELECT * FROM finish();
ROLLBACK;
