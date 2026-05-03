-- pgTAP: coach and field imports can be validated, reviewed, applied later,
-- or canceled without touching domain tables.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(12);

INSERT INTO public.import_jobs (
    id, organization_id, job_type, storage_path, status, created_by, total_rows
)
VALUES
    (
        '11111111-4444-4444-4444-777777777771',
        'a1111111-1111-1111-1111-111111111111',
        'registration',
        'orga/deferred-coaches.csv',
        'importing',
        '11111111-1111-1111-1111-111111111111',
        1
    ),
    (
        '11111111-4444-4444-4444-777777777772',
        'a1111111-1111-1111-1111-111111111111',
        'fields',
        'orga/deferred-fields.csv',
        'importing',
        '11111111-1111-1111-1111-111111111111',
        1
    ),
    (
        '11111111-4444-4444-4444-777777777773',
        'a1111111-1111-1111-1111-111111111111',
        'fields',
        'orga/cancel-fields.csv',
        'importing',
        '11111111-1111-1111-1111-111111111111',
        1
    ),
    (
        '11111111-4444-4444-4444-777777777774',
        'a1111111-1111-1111-1111-111111111111',
        'registration',
        'orga/coach-denied.csv',
        'importing',
        '11111111-1111-1111-1111-111111111111',
        1
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
        '11111111-4444-4444-4444-777777777771',
        'coaches',
        1,
        '{"Coach Name":"Deferred Coach","Email":"deferred@example.com"}'::jsonb,
        jsonb_build_object(
            'full_name', 'Deferred Coach',
            'email', 'deferred@example.com'
        ),
        '[]'::jsonb
    ),
    (
        'a1111111-1111-1111-1111-111111111111',
        '11111111-4444-4444-4444-777777777772',
        'fields',
        1,
        '{"Location":"Review Park","Field":"Review Field","Type":"practice"}'::jsonb,
        jsonb_build_object(
            'location', 'Review Park',
            'name', 'Review Field',
            'type', 'practice',
            'day', 'Sat',
            'start', '10:00',
            'end', '11:00'
        ),
        '[]'::jsonb
    ),
    (
        'a1111111-1111-1111-1111-111111111111',
        '11111111-4444-4444-4444-777777777773',
        'fields',
        1,
        '{"Location":"Cancel Park","Field":"Cancel Field","Type":"practice"}'::jsonb,
        jsonb_build_object(
            'location', 'Cancel Park',
            'name', 'Cancel Field',
            'type', 'practice',
            'day', 'Sun',
            'start', '12:00',
            'end', '13:00'
        ),
        '[]'::jsonb
    ),
    (
        'a1111111-1111-1111-1111-111111111111',
        '11111111-4444-4444-4444-777777777774',
        'coaches',
        1,
        '{"Coach Name":"Denied Coach","Email":"denied@example.com"}'::jsonb,
        jsonb_build_object(
            'full_name', 'Denied Coach',
            'email', 'denied@example.com'
        ),
        '[]'::jsonb
    );

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    public.mark_import_job_ready_to_apply(
        '11111111-4444-4444-4444-777777777771',
        'coaches',
        '[]'::jsonb
    )->>'status',
    'ready_to_apply',
    'coach import can be marked ready to apply'
);

SELECT is(
    (
        SELECT status
        FROM public.import_jobs
        WHERE id = '11111111-4444-4444-4444-777777777771'
    ),
    'ready_to_apply',
    'ready coach import stores the ready_to_apply job status'
);

SELECT is(
    (
        SELECT warning_summary #>> '{deferred_apply,import_type}'
        FROM public.import_jobs
        WHERE id = '11111111-4444-4444-4444-777777777771'
    ),
    'coaches',
    'ready marker stores deferred apply metadata'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.audit_log
        WHERE resource_id = '11111111-4444-4444-4444-777777777771'
          AND action = 'import.validated'
    )::int,
    1,
    'ready marker writes an audit event'
);

SELECT is(
    public.finalize_coach_import_job(
        '11111111-4444-4444-4444-777777777771',
        '[]'::jsonb
    )->>'status',
    'completed',
    'ready coach import can still apply through the finalizer'
);

SELECT is(
    public.mark_import_job_ready_to_apply(
        '11111111-4444-4444-4444-777777777772',
        'fields',
        jsonb_build_array(jsonb_build_object(
            'row', 2,
            'field', 'start',
            'message', 'Missing required field: start'
        ))
    )->>'validation_error_rows',
    '1',
    'field ready marker preserves validation error counts'
);

SELECT is(
    (
        SELECT error_summary #>> '{rowErrors,0,field}'
        FROM public.import_jobs
        WHERE id = '11111111-4444-4444-4444-777777777772'
    ),
    'start',
    'field ready marker stores row errors for later apply'
);

SELECT is(
    public.mark_import_job_ready_to_apply(
        '11111111-4444-4444-4444-777777777773',
        'fields',
        '[]'::jsonb
    )->>'status',
    'ready_to_apply',
    'field import can be staged for review before cancellation'
);

SELECT is(
    public.cancel_ready_import_job(
        '11111111-4444-4444-4444-777777777773',
        'fields'
    )->>'status',
    'canceled',
    'ready field import can be canceled before apply'
);

SELECT is(
    (
        SELECT status
        FROM public.import_jobs
        WHERE id = '11111111-4444-4444-4444-777777777773'
    ),
    'failed',
    'canceled deferred import keeps history and blocks later finalization'
);

SELECT throws_ok(
    $$
        SELECT public.finalize_field_import_job(
            '11111111-4444-4444-4444-777777777773',
            '[]'::jsonb
        )
    $$,
    '22023',
    NULL,
    'canceled deferred import cannot be finalized later'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';

SELECT throws_ok(
    $$
        SELECT public.mark_import_job_ready_to_apply(
            '11111111-4444-4444-4444-777777777774',
            'coaches',
            '[]'::jsonb
        )
    $$,
    '42501',
    NULL,
    'Org A coach member cannot mark an import ready to apply'
);

SELECT * FROM finish();
ROLLBACK;
