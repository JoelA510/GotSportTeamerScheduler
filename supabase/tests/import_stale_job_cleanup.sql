-- pgTAP: stale active import jobs can be failed for retry without crossing orgs.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(10);

INSERT INTO public.import_jobs (
    id,
    organization_id,
    job_type,
    storage_path,
    status,
    created_by,
    total_rows,
    processed_rows,
    progress_percent,
    started_at,
    last_heartbeat_at
)
VALUES
    (
        '11111111-5555-5555-5555-000000000101',
        'a1111111-1111-1111-1111-111111111111',
        'registration',
        'orga/stale-importing.csv',
        'importing',
        '11111111-1111-1111-1111-111111111111',
        10,
        5,
        50,
        '2026-05-03T11:00:00Z',
        '2026-05-03T11:00:00Z'
    ),
    (
        '11111111-5555-5555-5555-000000000102',
        'a1111111-1111-1111-1111-111111111111',
        'registration',
        'orga/stale-processing.csv',
        'processing',
        '11111111-1111-1111-1111-111111111111',
        10,
        5,
        50,
        '2026-05-03T11:05:00Z',
        '2026-05-03T11:05:00Z'
    ),
    (
        '11111111-5555-5555-5555-000000000103',
        'a1111111-1111-1111-1111-111111111111',
        'registration',
        'orga/stale-queued.csv',
        'queued',
        '11111111-1111-1111-1111-111111111111',
        10,
        0,
        0,
        '2026-05-03T11:10:00Z',
        '2026-05-03T11:10:00Z'
    ),
    (
        '11111111-5555-5555-5555-000000000104',
        'a1111111-1111-1111-1111-111111111111',
        'registration',
        'orga/recent-importing.csv',
        'importing',
        '11111111-1111-1111-1111-111111111111',
        10,
        8,
        80,
        '2026-05-03T12:05:00Z',
        '2026-05-03T12:05:00Z'
    ),
    (
        '11111111-5555-5555-5555-000000000105',
        'a1111111-1111-1111-1111-111111111111',
        'fields',
        'orga/ready-fields.csv',
        'ready_to_apply',
        '11111111-1111-1111-1111-111111111111',
        10,
        10,
        100,
        '2026-05-03T11:00:00Z',
        '2026-05-03T11:00:00Z'
    ),
    (
        '11111111-5555-5555-5555-000000000106',
        'b2222222-2222-2222-2222-222222222222',
        'registration',
        'orgb/stale-importing.csv',
        'importing',
        '22222222-2222-2222-2222-222222222222',
        10,
        3,
        30,
        '2026-05-03T11:00:00Z',
        '2026-05-03T11:00:00Z'
    );

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

CREATE TEMP TABLE stale_cleanup_result AS
SELECT public.fail_stale_import_jobs(
    'a1111111-1111-1111-1111-111111111111',
    '2026-05-03T12:00:00Z'::timestamptz
) AS result;

SELECT is(
    ((SELECT result FROM stale_cleanup_result)->>'failed_jobs')::int,
    3,
    'Org A admin fails the three stale active jobs'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.import_jobs
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND id IN (
              '11111111-5555-5555-5555-000000000101',
              '11111111-5555-5555-5555-000000000102',
              '11111111-5555-5555-5555-000000000103'
          )
          AND status = 'failed'
    )::int,
    3,
    'stale queued/processing/importing jobs are marked failed'
);

SELECT is(
    (SELECT status FROM public.import_jobs WHERE id = '11111111-5555-5555-5555-000000000104'),
    'importing',
    'recent active job is left alone'
);

SELECT is(
    (SELECT status FROM public.import_jobs WHERE id = '11111111-5555-5555-5555-000000000105'),
    'ready_to_apply',
    'ready-to-apply job is left alone even with an old heartbeat'
);

RESET ROLE;

SELECT is(
    (SELECT status FROM public.import_jobs WHERE id = '11111111-5555-5555-5555-000000000106'),
    'importing',
    'cross-org stale job is left alone'
);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (
        SELECT error_summary #>> '{stale_cleanup,previous_status}'
        FROM public.import_jobs
        WHERE id = '11111111-5555-5555-5555-000000000101'
    ),
    'importing',
    'failed job records prior status in error summary'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.audit_log
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND action = 'import.failed'
          AND metadata->>'stage' = 'stale_cleanup'
          AND (metadata->>'failed_jobs')::int = 3
    )::int,
    1,
    'stale cleanup writes one import.failed audit event'
);

SELECT is(
    (public.fail_stale_import_jobs(
        'a1111111-1111-1111-1111-111111111111',
        '2026-05-03T12:00:00Z'::timestamptz
    )->>'failed_jobs')::int,
    0,
    'stale cleanup is idempotent after jobs are failed'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';

SELECT throws_ok(
    $$
        SELECT public.fail_stale_import_jobs(
            'a1111111-1111-1111-1111-111111111111',
            '2026-05-03T12:00:00Z'::timestamptz
        )
    $$,
    '42501',
    NULL,
    'non-admin org member cannot fail stale import jobs'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222"}';

SELECT throws_ok(
    $$
        SELECT public.fail_stale_import_jobs(
            'a1111111-1111-1111-1111-111111111111',
            '2026-05-03T12:00:00Z'::timestamptz
        )
    $$,
    '42501',
    NULL,
    'other-org admin cannot fail Org A stale import jobs'
);

SELECT * FROM finish();
ROLLBACK;
