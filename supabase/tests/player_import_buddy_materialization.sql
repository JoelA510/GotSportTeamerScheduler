-- pgTAP: player import buddy materialization promotes reciprocal requests into
-- player_buddies without widening org/admin boundaries.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(14);

INSERT INTO public.import_jobs (
    id, organization_id, job_type, storage_path, status, created_by, total_rows
)
VALUES (
    '11111111-2222-3333-4444-555555555557',
    'a1111111-1111-1111-1111-111111111111',
    'registration',
    'orga/buddy-import.csv',
    'importing',
    '11111111-1111-1111-1111-111111111111',
    9
);

INSERT INTO public.staging_players (
    organization_id,
    import_job_id,
    source_row_number,
    raw_payload,
    normalized_payload,
    validation_errors
)
VALUES
(
    'a1111111-1111-1111-1111-111111111111',
    '11111111-2222-3333-4444-555555555557',
    2,
    '{}'::jsonb,
    jsonb_build_object(
        'first_name', 'Avery',
        'last_name', 'Adams',
        'date_of_birth', '2016-04-02',
        'external_registration_id', 'GS-BUDDY-A',
        'division_name', 'Org A U10',
        'buddy_request', 'GS-BUDDY-B'
    ),
    '[]'::jsonb
),
(
    'a1111111-1111-1111-1111-111111111111',
    '11111111-2222-3333-4444-555555555557',
    3,
    '{}'::jsonb,
    jsonb_build_object(
        'first_name', 'Blair',
        'last_name', 'Bennett',
        'date_of_birth', '2016-05-03',
        'external_registration_id', 'GS-BUDDY-B',
        'division_name', 'Org A U10',
        'buddy_request', 'GS-BUDDY-A'
    ),
    '[]'::jsonb
),
(
    'a1111111-1111-1111-1111-111111111111',
    '11111111-2222-3333-4444-555555555557',
    4,
    '{}'::jsonb,
    jsonb_build_object(
        'first_name', 'Casey',
        'last_name', 'Cole',
        'date_of_birth', '2016-06-04',
        'external_registration_id', 'GS-BUDDY-C',
        'division_name', 'Org A U10',
        'buddy_request', 'GS-MISSING'
    ),
    '[]'::jsonb
),
(
    'a1111111-1111-1111-1111-111111111111',
    '11111111-2222-3333-4444-555555555557',
    5,
    '{}'::jsonb,
    jsonb_build_object(
        'first_name', 'Drew',
        'last_name', 'Diaz',
        'date_of_birth', '2016-07-05',
        'external_registration_id', 'GS-BUDDY-D',
        'division_name', 'Org A U10',
        'buddy_request', 'GS-BUDDY-D'
    ),
    '[]'::jsonb
),
(
    'a1111111-1111-1111-1111-111111111111',
    '11111111-2222-3333-4444-555555555557',
    6,
    '{}'::jsonb,
    jsonb_build_object(
        'first_name', 'Emery',
        'last_name', 'Evans',
        'date_of_birth', '2016-08-06',
        'external_registration_id', 'GS-BUDDY-E',
        'division_name', 'Org A U10',
        'mutual_buddy_code', 'PAIR-CODE'
    ),
    '[]'::jsonb
),
(
    'a1111111-1111-1111-1111-111111111111',
    '11111111-2222-3333-4444-555555555557',
    7,
    '{}'::jsonb,
    jsonb_build_object(
        'first_name', 'Finley',
        'last_name', 'Foster',
        'date_of_birth', '2016-09-07',
        'external_registration_id', 'GS-BUDDY-F',
        'division_name', 'Org A U10',
        'mutual_buddy_code', 'PAIR-CODE'
    ),
    '[]'::jsonb
),
(
    'a1111111-1111-1111-1111-111111111111',
    '11111111-2222-3333-4444-555555555557',
    8,
    '{}'::jsonb,
    jsonb_build_object(
        'first_name', 'Gray',
        'last_name', 'Garcia',
        'date_of_birth', '2016-10-08',
        'external_registration_id', 'GS-BUDDY-G',
        'division_name', 'Org A U10',
        'mutual_buddy_code', 'TRIO-CODE'
    ),
    '[]'::jsonb
),
(
    'a1111111-1111-1111-1111-111111111111',
    '11111111-2222-3333-4444-555555555557',
    9,
    '{}'::jsonb,
    jsonb_build_object(
        'first_name', 'Harper',
        'last_name', 'Hall',
        'date_of_birth', '2016-11-09',
        'external_registration_id', 'GS-BUDDY-H',
        'division_name', 'Org A U10',
        'mutual_buddy_code', 'TRIO-CODE'
    ),
    '[]'::jsonb
),
(
    'a1111111-1111-1111-1111-111111111111',
    '11111111-2222-3333-4444-555555555557',
    10,
    '{}'::jsonb,
    jsonb_build_object(
        'first_name', 'Indigo',
        'last_name', 'Ibarra',
        'date_of_birth', '2016-12-10',
        'external_registration_id', 'GS-BUDDY-I',
        'division_name', 'Org A U10',
        'mutual_buddy_code', 'TRIO-CODE'
    ),
    '[]'::jsonb
);

INSERT INTO public.import_jobs (
    id, organization_id, job_type, storage_path, status, created_by, total_rows
)
VALUES (
    '11111111-2222-3333-4444-555555555558',
    'a1111111-1111-1111-1111-111111111111',
    'fields',
    'orga/fields.csv',
    'completed',
    '11111111-1111-1111-1111-111111111111',
    1
);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (public.finalize_import_job(
        '11111111-2222-3333-4444-555555555557',
        '[]'::jsonb
    )->>'inserted_players')::int,
    9,
    'finalize_import_job promotes the staged buddy fixture players'
);

SELECT is(
    (public.materialize_import_buddy_pairs(
        '11111111-2222-3333-4444-555555555557'
    )->>'materialized_pairs')::int,
    2,
    'materialize_import_buddy_pairs finds reciprocal and buddy-code pairs'
);

SELECT is(
    (SELECT count(*) FROM public.player_buddies
     WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
       AND source_import_job = '11111111-2222-3333-4444-555555555557')::int,
    4,
    'buddy pairs are stored as directional player_buddies rows'
);

SELECT ok(
    (SELECT bool_and(is_mutual) FROM public.player_buddies
     WHERE source_import_job = '11111111-2222-3333-4444-555555555557'),
    'materialized buddy rows are marked mutual'
);

SELECT is(
    (SELECT warning_summary #>> '{buddy_pairs,status}'
     FROM public.import_jobs
     WHERE id = '11111111-2222-3333-4444-555555555557'),
    'completed_with_warnings',
    'buddy materialization summary is persisted on the import job'
);

SELECT is(
    (SELECT status FROM public.import_jobs
     WHERE id = '11111111-2222-3333-4444-555555555557'),
    'completed_with_warnings',
    'unmatched and self-referential requests move the job to completed_with_warnings'
);

SELECT is(
    (SELECT warning_summary #>> '{buddy_pairs,unmatched_request_rows}'
     FROM public.import_jobs
     WHERE id = '11111111-2222-3333-4444-555555555557')::int,
    1,
    'unmatched buddy request rows are counted'
);

SELECT is(
    (SELECT warning_summary #>> '{buddy_pairs,self_request_rows}'
     FROM public.import_jobs
     WHERE id = '11111111-2222-3333-4444-555555555557')::int,
    1,
    'self buddy request rows are counted'
);

SELECT is(
    (SELECT warning_summary #>> '{buddy_pairs,invalid_code_groups}'
     FROM public.import_jobs
     WHERE id = '11111111-2222-3333-4444-555555555557')::int,
    1,
    'invalid mutual buddy code groups are counted'
);

SELECT is(
    (public.materialize_import_buddy_pairs(
        '11111111-2222-3333-4444-555555555557'
    )->>'inserted_relationships')::int,
    0,
    're-running buddy materialization is idempotent'
);

SELECT is(
    (SELECT count(*) FROM public.player_buddies
     WHERE source_import_job = '11111111-2222-3333-4444-555555555557')::int,
    4,
    'idempotent rerun does not duplicate player_buddies rows'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';

SELECT throws_ok(
    $$ SELECT public.materialize_import_buddy_pairs('11111111-2222-3333-4444-555555555557') $$,
    '42501',
    NULL,
    'Org A coach cannot materialize buddy pairs'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222"}';

SELECT throws_ok(
    $$ SELECT public.materialize_import_buddy_pairs('11111111-2222-3333-4444-555555555557') $$,
    '42501',
    NULL,
    'Org B admin cannot materialize an Org A import job'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT throws_ok(
    $$ SELECT public.materialize_import_buddy_pairs('11111111-2222-3333-4444-555555555558') $$,
    '22023',
    NULL,
    'buddy materialization rejects non-registration import jobs'
);

SELECT * FROM finish();
ROLLBACK;
