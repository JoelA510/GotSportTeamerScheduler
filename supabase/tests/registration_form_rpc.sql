-- pgTAP: registration form creation is org-scoped and auditable.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(10);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (public.admin_create_registration_form(
        'a1111111-1111-1111-1111-111111111111',
        'Org A Fall Registration',
        'Fall season registration',
        'a1111111-1111-1111-1111-111111111aaa',
        '[{"label":"Emergency Contact","type":"text","required":true}]'::jsonb,
        'active',
        '{"source":"pgtap"}'::jsonb
    )->>'status'),
    'open',
    'Org A admin can create a registration form and active is normalized to open'
);

SELECT results_eq(
    $$
        SELECT organization_id,
               season_id,
               title,
               description,
               status,
               jsonb_array_length(fields)
          FROM public.registration_forms
         WHERE title = 'Org A Fall Registration'
    $$,
    $$
        VALUES (
            'a1111111-1111-1111-1111-111111111111'::uuid,
            'a1111111-1111-1111-1111-111111111aaa'::uuid,
            'Org A Fall Registration'::text,
            'Fall season registration'::text,
            'open'::text,
            1
        )
    $$,
    'created registration form is stored with Org A season and fields'
);

SELECT is(
    (
        SELECT count(*)
          FROM public.audit_log
         WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
           AND action = 'registration.form_created'
           AND resource_type = 'registration_form'
           AND metadata->>'source' = 'pgtap'
    )::integer,
    1,
    'registration form creation writes one audit row'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';

SELECT throws_ok(
    $$
        SELECT public.admin_create_registration_form(
            'a1111111-1111-1111-1111-111111111111',
            'Coach Form',
            NULL,
            NULL,
            '[]'::jsonb,
            'open',
            '{}'::jsonb
        )
    $$,
    '42501',
    NULL,
    'Org A coach cannot create registration forms'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222"}';

SELECT throws_ok(
    $$
        SELECT public.admin_create_registration_form(
            'a1111111-1111-1111-1111-111111111111',
            'Cross Admin Form',
            NULL,
            NULL,
            '[]'::jsonb,
            'open',
            '{}'::jsonb
        )
    $$,
    '42501',
    NULL,
    'Org B admin cannot create Org A registration forms'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT throws_ok(
    $$
        SELECT public.admin_create_registration_form(
            'a1111111-1111-1111-1111-111111111111',
            'Wrong Season Form',
            NULL,
            'b2222222-2222-2222-2222-222222222bbb',
            '[]'::jsonb,
            'open',
            '{}'::jsonb
        )
    $$,
    '42501',
    NULL,
    'season must belong to the requested organization'
);

SELECT throws_ok(
    $$
        SELECT public.admin_create_registration_form(
            'a1111111-1111-1111-1111-111111111111',
            '',
            NULL,
            NULL,
            '[]'::jsonb,
            'open',
            '{}'::jsonb
        )
    $$,
    '23502',
    NULL,
    'title is required'
);

SELECT throws_ok(
    $$
        SELECT public.admin_create_registration_form(
            'a1111111-1111-1111-1111-111111111111',
            'Bad Fields',
            NULL,
            NULL,
            '{"label":"not-array"}'::jsonb,
            'open',
            '{}'::jsonb
        )
    $$,
    '22023',
    NULL,
    'fields must be a JSON array'
);

SELECT throws_ok(
    $$
        SELECT public.admin_create_registration_form(
            'a1111111-1111-1111-1111-111111111111',
            'Bad Status',
            NULL,
            NULL,
            '[]'::jsonb,
            'active-ish',
            '{}'::jsonb
        )
    $$,
    '23514',
    NULL,
    'invalid registration form status is rejected'
);

SELECT ok(
    (
        SELECT pg_get_constraintdef(oid)
          FROM pg_constraint
         WHERE conrelid = 'public.audit_log'::regclass
           AND conname = 'audit_log_action_check'
    ) LIKE '%registration.form_created%',
    'audit constraint allows registration.form_created'
);

SELECT * FROM finish();
ROLLBACK;
