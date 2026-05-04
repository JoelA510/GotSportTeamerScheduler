-- pgTAP: admin compliance medical-clearance mutations are org-scoped and audited.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(9);

INSERT INTO public.players (id, organization_id, division_id, first_name, last_name)
VALUES
    (
        'a1111111-1111-1111-1111-00000000ac01',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-11111111abcd',
        'Ada',
        'Compliance'
    ),
    (
        'b2222222-2222-2222-2222-00000000bc01',
        'b2222222-2222-2222-2222-222222222222',
        'b2222222-2222-2222-2222-22222222bcde',
        'Ben',
        'Compliance'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.registration_forms (id, organization_id, title, season_id, status)
VALUES
    (
        'a1111111-1111-1111-1111-00000000af01',
        'a1111111-1111-1111-1111-111111111111',
        'Org A Compliance Form',
        'a1111111-1111-1111-1111-111111111aaa',
        'open'
    ),
    (
        'b2222222-2222-2222-2222-00000000bf01',
        'b2222222-2222-2222-2222-222222222222',
        'Org B Compliance Form',
        'b2222222-2222-2222-2222-222222222bbb',
        'open'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.registrations (
    id,
    organization_id,
    form_id,
    player_id,
    profile_id,
    medical_cleared,
    waiver_signed
)
VALUES
    (
        'a1111111-1111-1111-1111-00000000ae01',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-00000000af01',
        'a1111111-1111-1111-1111-00000000ac01',
        '11111111-1111-1111-1111-111111111111',
        false,
        true
    ),
    (
        'b2222222-2222-2222-2222-00000000be01',
        'b2222222-2222-2222-2222-222222222222',
        'b2222222-2222-2222-2222-00000000bf01',
        'b2222222-2222-2222-2222-00000000bc01',
        '22222222-2222-2222-2222-222222222222',
        false,
        true
    )
ON CONFLICT (id) DO NOTHING;

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}';

SELECT lives_ok(
    $$
        SELECT public.admin_update_registration_medical_status(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-00000000ae01',
            true,
            '{"source":"pgtap"}'::jsonb
        )
    $$,
    'Org A admin can update an Org A registration medical status'
);

SELECT is(
    (
        SELECT medical_cleared
        FROM public.registrations
        WHERE id = 'a1111111-1111-1111-1111-00000000ae01'
    ),
    true,
    'registration medical status is persisted'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.audit_log
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND action = 'compliance.medical_update'
          AND resource_type = 'registration'
          AND resource_id = 'a1111111-1111-1111-1111-00000000ae01'
    )::int,
    1,
    'medical status update writes one audit row'
);

SELECT is(
    (
        SELECT metadata->>'source'
        FROM public.audit_log
        WHERE action = 'compliance.medical_update'
          AND resource_id = 'a1111111-1111-1111-1111-00000000ae01'
    ),
    'pgtap',
    'audit metadata includes caller-supplied context'
);

SELECT is(
    (
        SELECT (public.admin_update_registration_medical_status(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-00000000ae01',
            true
        )->>'changed')::boolean
    ),
    false,
    'repeating the same status is an idempotent no-op'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"role":"admin"}}';

SELECT throws_ok(
    $$
        SELECT public.admin_update_registration_medical_status(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-00000000ae01',
            false
        )
    $$,
    '42501',
    NULL,
    'Org B admin cannot update an Org A registration'
);

SELECT throws_ok(
    $$
        SELECT public.admin_update_registration_medical_status(
            'b2222222-2222-2222-2222-222222222222',
            'a1111111-1111-1111-1111-00000000ae01',
            false
        )
    $$,
    '42501',
    NULL,
    'registration id must belong to the requested organization'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333","app_metadata":{"role":"coach"}}';

SELECT throws_ok(
    $$
        SELECT public.admin_update_registration_medical_status(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-00000000ae01',
            false
        )
    $$,
    '42501',
    NULL,
    'Org coach cannot update medical status'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}';

SELECT throws_ok(
    $$
        SELECT public.admin_update_registration_medical_status(
            'a1111111-1111-1111-1111-111111111111',
            NULL::uuid,
            true
        )
    $$,
    '23502',
    NULL,
    'missing registration id is rejected'
);

SELECT * FROM finish();
ROLLBACK;
