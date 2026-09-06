-- RLS invariants for `field_blackouts` and the `field_closures` reader.
--
-- **Everything else in 8.4 PR 2 checks these policies STRUCTURALLY.** The
-- migration smoke asserts RLS is enabled, that there is exactly one policy, and
-- that it is not `USING (true)`; the local harness in `scripts/dbharness/` runs
-- every migration as the cluster superuser, for whom RLS does not apply at all.
-- So until this file existed, no check anywhere exercised the policies. A policy
-- that is present, correctly shaped, and never evaluated is the same falsely
-- perfect result this phase keeps finding in other disguises.
--
-- Three things, and only these three:
--
--   1. An authenticated NON-MEMBER sees zero rows -- from the table AND from
--      `field_closures`, because the view is `security_invoker` and a reader
--      that leaked would make the table's policy beside the point.
--   2. An authenticated MEMBER cannot INSERT, UPDATE or DELETE the table
--      directly. There is deliberately no write policy: writes go through the
--      `SECURITY DEFINER` RPCs, which re-check org membership.
--   3. An ADMIN of org A cannot create a blackout scoped to org B's location or
--      field. This is the one a reading cannot settle, because it depends on
--      the RPC's own ownership re-check firing rather than on the policy --
--      `SECURITY DEFINER` runs as the owner, so RLS is not what stops it.
--
-- Exercises: `field_blackouts` RLS, `field_closures` security_invoker,
-- `admin_create_field_blackout` org re-check.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

-- Ground for both orgs, seeded as the superuser before any role is assumed.
INSERT INTO public.locations (id, organization_id, name)
VALUES
    ('c1111111-1111-1111-1111-1111111111aa', 'a1111111-1111-1111-1111-111111111111', 'Park A'),
    ('c2222222-2222-2222-2222-2222222222bb', 'b2222222-2222-2222-2222-222222222222', 'Park B')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.fields (id, organization_id, location_id, name)
VALUES
    ('d1111111-1111-1111-1111-1111111111aa', 'a1111111-1111-1111-1111-111111111111',
     'c1111111-1111-1111-1111-1111111111aa', 'Pitch A'),
    ('d2222222-2222-2222-2222-2222222222bb', 'b2222222-2222-2222-2222-222222222222',
     'c2222222-2222-2222-2222-2222222222bb', 'Pitch B')
ON CONFLICT (id) DO NOTHING;

-- One blackout per org, written as the superuser so the SELECT tests below are
-- about who can READ them rather than about who managed to write them.
INSERT INTO public.field_blackouts
    (id, organization_id, location_id, field_id, blackout_from, blackout_until, reason)
VALUES
    ('e1111111-1111-1111-1111-1111111111aa', 'a1111111-1111-1111-1111-111111111111',
     NULL, 'd1111111-1111-1111-1111-1111111111aa', '2026-08-01', '2026-08-02', 'maintenance'),
    ('e2222222-2222-2222-2222-2222222222bb', 'b2222222-2222-2222-2222-222222222222',
     NULL, 'd2222222-2222-2222-2222-2222222222bb', '2026-08-01', '2026-08-02', 'weather');

SELECT plan(11);

-- ── Meta: the rows really exist, so a zero below means RLS and not an empty
--    table. Every assertion in this file is about a subset of these two.
SELECT is(
    (SELECT COUNT(*) FROM public.field_blackouts)::int,
    2,
    'the fixture wrote two blackouts, one per org (as superuser, RLS bypassed)'
);

-- ── 1. A non-member sees nothing ──────────────────────────────────────────
--
-- Charlie is a COACH at Org A, so he is a member there. To test a genuine
-- non-member we use Bob, who is an admin of Org B and a member of nothing in
-- Org A -- the row he must not see is Org A's.
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222"}';

SELECT is(
    (SELECT COUNT(*) FROM public.field_blackouts
       WHERE organization_id = 'a1111111-1111-1111-1111-111111111111')::int,
    0,
    'Bob (Org B) sees zero of Org A''s field_blackouts'
);

SELECT is(
    (SELECT COUNT(*) FROM public.field_blackouts)::int,
    1,
    'Bob sees exactly his own org''s blackout, so the policy filters rather than blocks'
);

-- The single reader is `security_invoker`, so it must filter identically. A
-- view that ran as its owner would hand every org its neighbours' closures
-- while the table's policy sat there looking correct.
SELECT is(
    (SELECT COUNT(*) FROM public.field_closures
       WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
         AND source = 'field_blackouts')::int,
    0,
    'Bob sees zero of Org A''s closures through field_closures'
);

SELECT is(
    (SELECT COUNT(*) FROM public.field_closures
       WHERE source = 'field_blackouts')::int,
    1,
    'Bob still sees his own org''s closure through the view'
);

-- ── 2. A member cannot write the table directly ───────────────────────────
--
-- Alice is an ADMIN of Org A and the row is Org A's, so nothing but the
-- absence of a write policy stops her. `42501` is insufficient_privilege,
-- which is what a missing policy raises.
-- Identity changes by re-setting the claim, with the role left as
-- `authenticated` -- the way `rls_admin_vs_coach.sql` does it.
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT throws_ok(
    $$INSERT INTO public.field_blackouts
        (organization_id, field_id, blackout_from, blackout_until, reason)
      VALUES ('a1111111-1111-1111-1111-111111111111',
              'd1111111-1111-1111-1111-1111111111aa', '2026-09-01', '2026-09-02', 'event')$$,
    '42501',
    NULL,
    'an org admin cannot INSERT field_blackouts directly'
);

-- **UPDATE and DELETE no-op rather than raise, and that is not a weaker
-- result.** With RLS on and no permissive policy for the command, the rows are
-- simply not visible to it, so zero are affected and no error is produced. Only
-- INSERT raises, because a row that passes no WITH CHECK is a violation rather
-- than an absence. Written the way `rls_stale_broad_write_policies_removed.sql`
-- writes the same pair, so this file does not invent a third convention -- and
-- asserted as "the row is unchanged / still there", which is the observable
-- fact either way and would catch a policy that let the write through.
UPDATE public.field_blackouts SET reason = 'other'
 WHERE id = 'e1111111-1111-1111-1111-1111111111aa';
SELECT is(
    (SELECT reason FROM public.field_blackouts
       WHERE id = 'e1111111-1111-1111-1111-1111111111aa'),
    'maintenance',
    'an org admin cannot UPDATE field_blackouts directly'
);

DELETE FROM public.field_blackouts
 WHERE id = 'e1111111-1111-1111-1111-1111111111aa';
SELECT is(
    (SELECT COUNT(*) FROM public.field_blackouts
       WHERE id = 'e1111111-1111-1111-1111-1111111111aa')::int,
    1,
    'an org admin cannot DELETE field_blackouts directly'
);

-- ── 3. The RPC's own org re-check ─────────────────────────────────────────
--
-- `admin_create_field_blackout` is SECURITY DEFINER, so it runs as the owner
-- and RLS is not what stops a cross-org write. Only the function's own
-- ownership check does, which is why this is the assertion a code reading
-- cannot settle. Alice is a genuine admin -- of the WRONG org for this ground.
SELECT throws_ok(
    $$SELECT public.admin_create_field_blackout(
        p_organization_id => 'a1111111-1111-1111-1111-111111111111',
        p_location_id     => 'c2222222-2222-2222-2222-2222222222bb',
        p_field_id        => NULL,
        p_blackout_from   => '2026-09-01',
        p_blackout_until  => '2026-09-02',
        p_reason          => 'maintenance')$$,
    'P0002',
    NULL,
    'an Org A admin cannot blackout Org B''s LOCATION'
);

SELECT throws_ok(
    $$SELECT public.admin_create_field_blackout(
        p_organization_id => 'a1111111-1111-1111-1111-111111111111',
        p_location_id     => NULL,
        p_field_id        => 'd2222222-2222-2222-2222-2222222222bb',
        p_blackout_from   => '2026-09-01',
        p_blackout_until  => '2026-09-02',
        p_reason          => 'maintenance')$$,
    'P0002',
    NULL,
    'an Org A admin cannot blackout Org B''s FIELD'
);

-- ... and the positive control: the same call against her OWN ground works.
-- Without this, every assertion above is satisfied by an RPC that refuses
-- everything, which would prove nothing about the ownership check.
SELECT lives_ok(
    $$SELECT public.admin_create_field_blackout(
        p_organization_id => 'a1111111-1111-1111-1111-111111111111',
        p_location_id     => 'c1111111-1111-1111-1111-1111111111aa',
        p_field_id        => NULL,
        p_blackout_from   => '2026-09-01',
        p_blackout_until  => '2026-09-02',
        p_reason          => 'maintenance')$$,
    'the same admin CAN blackout her own org''s location'
);

SELECT * FROM finish();
ROLLBACK;
