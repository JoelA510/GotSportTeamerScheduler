-- Behavioral verification for 20260726000000_drop_stale_broad_write_policies.sql
--
-- Charlie is a coach (non-admin) member of Org A. Before this migration, the
-- stale "Unified org access on teams/coaches/locations" policy let any org
-- member -- Charlie included -- write to these tables directly. After the
-- migration, only the narrow SELECT policies remain for `authenticated`.
--
-- Note the two different RLS failure modes:
--   * UPDATE/DELETE affect zero rows silently -- the surviving SELECT
--     policy's USING clause filters the target row out of the statement's
--     visibility, so there is simply nothing to modify.
--   * INSERT RAISES 42501 -- there is no existing row to filter, so the
--     absent INSERT policy fails the WITH CHECK outright. This matches the
--     established expectation in supabase/tests/facility_admin_rpcs.sql:204.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(6);

-- Seed one location in Org A (not part of the shared fixture).
INSERT INTO public.locations (id, organization_id, name)
VALUES ('c0c0c0c0-0000-0000-0000-000000000001', 'a1111111-1111-1111-1111-111111111111', 'Org A Field House')
ON CONFLICT (id) DO NOTHING;

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';

-- 1. Charlie (coach, Org A) cannot rename A-Team directly.
UPDATE public.teams SET name = 'Hijacked Team Name'
WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT name FROM public.teams WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'A-Team',
  'coach cannot rename a team via direct UPDATE'
);

-- 2. Charlie cannot delete A-Team directly.
DELETE FROM public.teams WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
SELECT is(
  (SELECT count(*)::int FROM public.teams WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1,
  'coach cannot delete a team via direct DELETE'
);

-- 3. Charlie cannot insert a new coach row directly. INSERT raises rather
--    than no-opping (see the failure-mode note in the header).
SELECT throws_ok(
  $$
    INSERT INTO public.coaches (organization_id, full_name, email)
    VALUES ('a1111111-1111-1111-1111-111111111111', 'Fabricated Coach', 'fabricated@test.local')
  $$,
  '42501',
  NULL,
  'coach cannot insert a new coach row via direct INSERT'
);

-- 4. Charlie cannot rename the Org A location directly.
UPDATE public.locations SET name = 'Hijacked Location'
WHERE id = 'c0c0c0c0-0000-0000-0000-000000000001';
SELECT is(
  (SELECT name FROM public.locations WHERE id = 'c0c0c0c0-0000-0000-0000-000000000001'),
  'Org A Field House',
  'coach cannot rename a location via direct UPDATE'
);

-- 5. Charlie can still SELECT the team (narrow read policy is untouched).
SELECT is(
  (SELECT name FROM public.teams WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'A-Team',
  'coach retains SELECT access to their org''s team'
);

-- 6. Charlie can still SELECT the location (narrow read policy is untouched).
SELECT is(
  (SELECT count(*)::int FROM public.locations WHERE id = 'c0c0c0c0-0000-0000-0000-000000000001'),
  1,
  'coach retains SELECT access to their org''s location'
);

SELECT * FROM finish();
ROLLBACK;
