-- pgTAP: field CSV imports stage, apply, and roll back through RPCs.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(14);

INSERT INTO public.import_jobs (
    id, organization_id, job_type, storage_path, status, created_by, total_rows
)
VALUES
    (
        '11111111-3333-3333-3333-666666666661',
        'a1111111-1111-1111-1111-111111111111',
        'fields',
        'orga/fields.csv',
        'importing',
        '11111111-1111-1111-1111-111111111111',
        2
    ),
    (
        '11111111-3333-3333-3333-666666666662',
        'a1111111-1111-1111-1111-111111111111',
        'fields',
        'orga/fields-empty.csv',
        'importing',
        '11111111-1111-1111-1111-111111111111',
        0
    ),
    (
        '11111111-3333-3333-3333-666666666663',
        'a1111111-1111-1111-1111-111111111111',
        'fields',
        'orga/fields-invalid.csv',
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
        '11111111-3333-3333-3333-666666666661',
        'fields',
        1,
        '{"Location":"North Complex","Field":"Field 1","Type":"practice"}'::jsonb,
        jsonb_build_object(
            'location', 'North Complex',
            'address', '100 Main St',
            'lighting_available', 'yes',
            'name', 'Field 1',
            'surface_type', 'Grass',
            'size', '7v7',
            'subunit', 'A',
            'type', 'practice',
            'day', 'Fri',
            'start', '17:30',
            'end', '18:30',
            'capacity', '1',
            'valid_from', '2026-03-01',
            'valid_until', '2026-05-31'
        ),
        '[]'::jsonb
    ),
    (
        'a1111111-1111-1111-1111-111111111111',
        '11111111-3333-3333-3333-666666666661',
        'fields',
        2,
        '{"Location":"north complex","Field":"Field 1","Type":"game"}'::jsonb,
        jsonb_build_object(
            'location', 'north complex',
            'name', 'Field 1',
            'type', 'game',
            'slot_date', '2026-04-04',
            'start', '09:00',
            'end', '10:00',
            'capacity', '1',
            'week_index', '1'
        ),
        '[]'::jsonb
    ),
    (
        'a1111111-1111-1111-1111-111111111111',
        '11111111-3333-3333-3333-666666666663',
        'fields',
        1,
        '{"Location":"South","Field":"Bad","Type":"other"}'::jsonb,
        jsonb_build_object(
            'location', 'South',
            'name', 'Bad',
            'type', 'other',
            'start', '09:00',
            'end', '10:00'
        ),
        '[]'::jsonb
    );

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (public.finalize_field_import_job(
        '11111111-3333-3333-3333-666666666661',
        '[]'::jsonb
    )->>'inserted_locations')::int,
    1,
    'field import inserts a new location'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.fields f
        JOIN public.locations l ON l.id = f.location_id
        WHERE f.organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND lower(l.name) = 'north complex'
          AND lower(f.name) = 'field 1'
    )::int,
    1,
    'field import upserts one case-insensitive field'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.field_subunits fs
        JOIN public.fields f ON f.id = fs.field_id
        WHERE f.organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND lower(f.name) = 'field 1'
          AND fs.label = 'A'
    )::int,
    1,
    'field import ensures a requested field subunit exists'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.practice_slots ps
        JOIN public.fields f ON f.id = ps.field_id
        WHERE ps.organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND lower(f.name) = 'field 1'
          AND ps.day_of_week = 'fri'::public.day_of_week
          AND ps.start_time = '17:30'::time
    )::int,
    1,
    'field import inserts a practice slot'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.game_slots gs
        JOIN public.fields f ON f.id = gs.field_id
        WHERE gs.organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND lower(f.name) = 'field 1'
          AND gs.slot_date = '2026-04-04'::date
          AND gs.start_time = '09:00'::time
    )::int,
    1,
    'field import inserts a game slot'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.import_application_records
        WHERE import_job_id = '11111111-3333-3333-3333-666666666661'
          AND import_type = 'fields'
    )::int,
    5,
    'field import records one ledger row per inserted location, field, subunit, and slot'
);

SELECT is(
    (public.finalize_field_import_job(
        '11111111-3333-3333-3333-666666666661',
        '[]'::jsonb
    )->>'inserted_fields')::int,
    0,
    'field import finalization is idempotent for the same job'
);

SELECT is(
    (public.finalize_field_import_job(
        '11111111-3333-3333-3333-666666666663',
        '[]'::jsonb
    )->>'invalid_rows')::int,
    1,
    'field import reports invalid slot rows as warnings'
);

SELECT is(
    (public.rollback_field_import_job(
        '11111111-3333-3333-3333-666666666661'
    )->>'deleted_practice_slots')::int,
    1,
    'field rollback deletes practice slots inserted by the job'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.fields f
        JOIN public.locations l ON l.id = f.location_id
        WHERE f.organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND lower(l.name) = 'north complex'
          AND lower(f.name) = 'field 1'
    )::int,
    0,
    'field rollback deletes fields inserted by the job'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.locations
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND lower(name) = 'north complex'
    )::int,
    0,
    'field rollback deletes locations inserted by the job when empty'
);

SELECT throws_ok(
    $$
        SELECT public.rollback_field_import_job(
            '11111111-3333-3333-3333-666666666662'
        )
    $$,
    '22023',
    NULL,
    'field rollback rejects a job with no applied field records'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';

SELECT throws_ok(
    $$
        SELECT public.finalize_field_import_job(
            '11111111-3333-3333-3333-666666666663',
            '[]'::jsonb
        )
    $$,
    '42501',
    NULL,
    'Org A coach member cannot finalize field imports'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT throws_ok(
    $$
        SELECT public.finalize_field_import_job(
            'aaaabbbb-1111-1111-1111-111111111111',
            '[]'::jsonb
        )
    $$,
    '22023',
    NULL,
    'field finalizer rejects non-field import jobs'
);

SELECT * FROM finish();
ROLLBACK;
