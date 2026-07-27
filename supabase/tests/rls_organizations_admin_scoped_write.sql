-- Behavioral verification for 20260726000100_fix_organizations_write_policy.sql
--
-- Alice is admin of Org A, Bob is admin of Org B, Charlie is a coach
-- (non-admin) of Org A. Before this migration, the write policy trusted a
-- raw app_metadata JWT claim nobody sets -- so in practice nobody could
-- write via RLS, but the *design* was a cross-org hole waiting for the
-- claim to be set through Supabase's own Auth Admin API. After the
-- migration, writes are gated on is_org_admin(id): Alice can update Org A,
-- Bob (admin elsewhere) cannot touch Org A, and Charlie (non-admin, in Org
-- A) cannot touch Org A either.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(3);

-- 1. Alice (admin, Org A) can update Org A's own name.
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';
UPDATE public.organizations SET name = 'Org A Renamed'
WHERE id = 'a1111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT name FROM public.organizations WHERE id = 'a1111111-1111-1111-1111-111111111111'),
  'Org A Renamed',
  'org admin can update their own organization'
);
RESET role;

-- 2. Bob (admin of Org B) cannot rename Org A.
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222"}';
UPDATE public.organizations SET name = 'Hijacked By Bob'
WHERE id = 'a1111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT name FROM public.organizations WHERE id = 'a1111111-1111-1111-1111-111111111111'),
  'Org A Renamed',
  'admin of a different org cannot rename Org A'
);
RESET role;

-- 3. Charlie (coach, non-admin, Org A) cannot rename Org A.
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';
UPDATE public.organizations SET name = 'Hijacked By Charlie'
WHERE id = 'a1111111-1111-1111-1111-111111111111';
SELECT is(
  (SELECT name FROM public.organizations WHERE id = 'a1111111-1111-1111-1111-111111111111'),
  'Org A Renamed',
  'non-admin member of Org A cannot rename their own organization'
);
RESET role;

SELECT * FROM finish();
ROLLBACK;
