-- pgTAP: durable GotSport import finalization promotes staged rows and keeps
-- org/admin boundaries intact.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(11);

INSERT INTO public.import_jobs (
    id, organization_id, job_type, storage_path, status, created_by, total_rows
)
VALUES (
    '11111111-2222-3333-4444-555555555555',
    'a1111111-1111-1111-1111-111111111111',
    'registration',
    'orga/gotsport.csv',
    'importing',
    '11111111-1111-1111-1111-111111111111',
    1
);

INSERT INTO public.staging_players (
    organization_id,
    import_job_id,
    source_row_number,
    raw_payload,
    normalized_payload,
    validation_errors
)
VALUES (
    'a1111111-1111-1111-1111-111111111111',
    '11111111-2222-3333-4444-555555555555',
    2,
    '{"First Name":"Riley","Last Name":"Reyes","Date of Birth":"2016-04-02"}'::jsonb,
    jsonb_build_object(
        'first_name', 'Riley',
        'last_name', 'Reyes',
        'date_of_birth', '2016-04-02',
        'external_registration_id', 'GS-123',
        'division_name', 'Org A U10',
        'skill_tier', 'developing',
        'willing_to_coach', 'yes'
    ),
    '[]'::jsonb
);

INSERT INTO public.import_jobs (
    id, organization_id, job_type, storage_path, status, created_by, total_rows
)
VALUES (
    '11111111-2222-3333-4444-555555555556',
    'a1111111-1111-1111-1111-111111111111',
    'registration',
    'orga/gotsport-update.csv',
    'importing',
    '11111111-1111-1111-1111-111111111111',
    1
);

INSERT INTO public.staging_players (
    organization_id,
    import_job_id,
    source_row_number,
    raw_payload,
    normalized_payload,
    validation_errors
)
VALUES (
    'a1111111-1111-1111-1111-111111111111',
    '11111111-2222-3333-4444-555555555556',
    2,
    '{"First Name":"Riley","Last Name":"Reyes","Date of Birth":"2016-04-02"}'::jsonb,
    jsonb_build_object(
        'first_name', 'Riley',
        'last_name', 'Reyes',
        'date_of_birth', '2016-04-02',
        'external_registration_id', 'GS-123',
        'grade', '4'
    ),
    '[]'::jsonb
);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (public.finalize_import_job(
        '11111111-2222-3333-4444-555555555555',
        '[]'::jsonb
    )->>'inserted_players')::int,
    1,
    'finalize_import_job inserts one player from staging'
);

SELECT is(
    (SELECT count(*) FROM public.players WHERE organization_id = 'a1111111-1111-1111-1111-111111111111' AND external_registration_id = 'GS-123')::int,
    1,
    'promoted player is scoped to Org A and keyed by GotSport registration id'
);

SELECT is(
    (SELECT division_id FROM public.players WHERE external_registration_id = 'GS-123'),
    'a1111111-1111-1111-1111-11111111abcd'::uuid,
    'division_name resolves to the org-scoped division'
);

SELECT ok(
    (SELECT willing_to_coach FROM public.players WHERE external_registration_id = 'GS-123'),
    'willing_to_coach is normalized to boolean true'
);

SELECT ok(
    (SELECT promoted_at IS NOT NULL FROM public.staging_players WHERE import_job_id = '11111111-2222-3333-4444-555555555555'),
    'staging row is marked promoted'
);

SELECT is(
    (SELECT status FROM public.import_jobs WHERE id = '11111111-2222-3333-4444-555555555555'),
    'completed',
    'import job status is completed after finalization'
);

SELECT is(
    (public.finalize_import_job(
        '11111111-2222-3333-4444-555555555555',
        '[]'::jsonb
    )->>'inserted_players')::int,
    0,
    're-running finalization is idempotent for the same import job'
);

SELECT is(
    (SELECT count(*) FROM public.players WHERE organization_id = 'a1111111-1111-1111-1111-111111111111' AND external_registration_id = 'GS-123')::int,
    1,
    'idempotent rerun does not duplicate players'
);

SELECT is(
    (public.finalize_import_job(
        '11111111-2222-3333-4444-555555555556',
        '[]'::jsonb
    )->>'updated_players')::int,
    1,
    'finalize_import_job updates an existing GotSport player by registration id'
);

SELECT is(
    (SELECT division_id FROM public.players WHERE external_registration_id = 'GS-123'),
    'a1111111-1111-1111-1111-11111111abcd'::uuid,
    'existing player division is preserved when the import row has no resolved division'
);

SELECT throws_ok(
    $$ SELECT public.finalize_import_job('aaaabbbb-2222-2222-2222-222222222222', '[]'::jsonb) $$,
    '42501',
    NULL,
    'Org A admin cannot finalize an Org B import job'
);

SELECT * FROM finish();
ROLLBACK;
