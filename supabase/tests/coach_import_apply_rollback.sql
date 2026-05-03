-- pgTAP: coach CSV imports stage, apply, and roll back through RPCs.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(15);

INSERT INTO public.import_jobs (
    id, organization_id, job_type, storage_path, status, created_by, total_rows
)
VALUES
    (
        '11111111-3333-3333-3333-555555555551',
        'a1111111-1111-1111-1111-111111111111',
        'registration',
        'orga/coaches.csv',
        'importing',
        '11111111-1111-1111-1111-111111111111',
        2
    ),
    (
        '11111111-3333-3333-3333-555555555552',
        'a1111111-1111-1111-1111-111111111111',
        'registration',
        'orga/coaches-update.csv',
        'importing',
        '11111111-1111-1111-1111-111111111111',
        1
    );

INSERT INTO public.coaches (
    id,
    organization_id,
    full_name,
    email,
    phone,
    status,
    can_coach_multiple_teams,
    import_source
)
VALUES
    (
        'a1111111-1111-1111-1111-00000000c301',
        'a1111111-1111-1111-1111-111111111111',
        'Existing Interested',
        'interested@example.com',
        '555-0000',
        'interested',
        false,
        'player_import_lead'
    ),
    (
        'b2222222-2222-2222-2222-00000000c302',
        'b2222222-2222-2222-2222-222222222222',
        'Org B Coach',
        'shared@example.com',
        NULL,
        'active',
        false,
        'manual'
    );

INSERT INTO public.staging_import_rows (
    organization_id,
    import_job_id,
    import_type,
    source_row_number,
    raw_payload,
    normalized_payload,
    validation_errors
)
VALUES
    (
        'a1111111-1111-1111-1111-111111111111',
        '11111111-3333-3333-3333-555555555551',
        'coaches',
        1,
        '{"Coach Name":"New Coach","Email":"newcoach@example.com"}'::jsonb,
        jsonb_build_object(
            'full_name', 'New Coach',
            'email', 'newcoach@example.com',
            'phone', '555-1111',
            'certifications', 'SafeSport, CPR',
            'can_coach_multiple_teams', 'yes'
        ),
        '[]'::jsonb
    ),
    (
        'a1111111-1111-1111-1111-111111111111',
        '11111111-3333-3333-3333-555555555551',
        'coaches',
        2,
        '{"Coach Name":"Existing Active","Email":"interested@example.com"}'::jsonb,
        jsonb_build_object(
            'full_name', 'Existing Active',
            'email', 'interested@example.com',
            'phone', '555-2222'
        ),
        '[]'::jsonb
    ),
    (
        'a1111111-1111-1111-1111-111111111111',
        '11111111-3333-3333-3333-555555555552',
        'coaches',
        1,
        '{"Coach Name":"Conflict","Email":"shared@example.com"}'::jsonb,
        jsonb_build_object(
            'full_name', 'Conflict',
            'email', 'shared@example.com'
        ),
        '[]'::jsonb
    );

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (public.finalize_coach_import_job(
        '11111111-3333-3333-3333-555555555551',
        '[]'::jsonb
    )->>'inserted_coaches')::int,
    1,
    'finalize_coach_import_job inserts a new coach'
);

SELECT is(
    (
        SELECT status
        FROM public.coaches
        WHERE email = 'interested@example.com'
    ),
    'active',
    'coach import promotes an interested lead to active'
);

SELECT is(
    (
        SELECT full_name
        FROM public.coaches
        WHERE email = 'interested@example.com'
    ),
    'Existing Active',
    'coach import updates an existing in-org coach'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.import_application_records
        WHERE import_job_id = '11111111-3333-3333-3333-555555555551'
          AND import_type = 'coaches'
    )::int,
    2,
    'coach import writes one application ledger row per applied coach'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.staging_import_rows
        WHERE import_job_id = '11111111-3333-3333-3333-555555555551'
          AND applied_at IS NOT NULL
    )::int,
    2,
    'staged coach rows are marked applied'
);

SELECT is(
    (
        SELECT status
        FROM public.import_jobs
        WHERE id = '11111111-3333-3333-3333-555555555551'
    ),
    'completed',
    'coach import job is completed after finalization'
);

SELECT is(
    (public.finalize_coach_import_job(
        '11111111-3333-3333-3333-555555555551',
        '[]'::jsonb
    )->>'inserted_coaches')::int,
    0,
    'coach import finalization is idempotent for the same job'
);

SELECT is(
    (public.finalize_coach_import_job(
        '11111111-3333-3333-3333-555555555552',
        '[]'::jsonb
    )->>'cross_org_conflict_rows')::int,
    1,
    'coach import rejects an email already owned by another organization'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.coaches
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND lower(email) = 'shared@example.com'
    )::int,
    0,
    'cross-org email rejection does not create an Org A duplicate coach'
);

SELECT is(
    (public.rollback_coach_import_job(
        '11111111-3333-3333-3333-555555555551'
    )->>'deleted_coaches')::int,
    1,
    'rollback deletes coaches inserted by the import'
);

SELECT is(
    (
        SELECT status
        FROM public.coaches
        WHERE id = 'a1111111-1111-1111-1111-00000000c301'
    ),
    'interested',
    'rollback restores the previous coach status'
);

SELECT is(
    (
        SELECT full_name
        FROM public.coaches
        WHERE id = 'a1111111-1111-1111-1111-00000000c301'
    ),
    'Existing Interested',
    'rollback restores the previous coach profile fields'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.import_application_records
        WHERE import_job_id = '11111111-3333-3333-3333-555555555551'
          AND rolled_back_at IS NOT NULL
    )::int,
    2,
    'rollback marks application ledger rows as rolled back'
);

SELECT throws_ok(
    $$
        SELECT public.rollback_coach_import_job(
            '11111111-3333-3333-3333-555555555552'
        )
    $$,
    '22023',
    NULL,
    'rollback rejects a coach import job with no applied coach records'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';

SELECT throws_ok(
    $$
        SELECT public.finalize_coach_import_job(
            '11111111-3333-3333-3333-555555555551',
            '[]'::jsonb
        )
    $$,
    '42501',
    NULL,
    'Org A coach member cannot finalize coach imports'
);

SELECT * FROM finish();
ROLLBACK;
