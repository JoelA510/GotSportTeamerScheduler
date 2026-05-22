BEGIN;
\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(8);

INSERT INTO public.import_jobs (id, organization_id, job_type, storage_path, status, created_by, total_rows)
VALUES ('11111111-3333-3333-3333-777777777771','a1111111-1111-1111-1111-111111111111','field_availability','orga/fall2026.csv','importing','11111111-1111-1111-1111-111111111111',1);

INSERT INTO public.staging_import_rows (organization_id, import_job_id, import_type, source_row_number, raw_payload, normalized_payload, validation_errors)
VALUES (
  'a1111111-1111-1111-1111-111111111111','11111111-3333-3333-3333-777777777771','field_availability',1,
  '{"season_label":"Fall 2026"}'::jsonb,
  jsonb_build_object(
    'season_label','Fall 2026','record_status','potential','location','Canyon','field_name','Canyon Turf',
    'primary_format','11v11','secondary_format','9v9','format_quantity','4','available_from','2026-08-01','available_until','2026-11-30',
    'blackout_months','Sep','teams_per_hour','2','aggregate_teams_per_hour','8','capacity_basis','aggregate','goal_equipment','sturdy goals','goal_status','needs_purchase','approval_status','pending'
  ),
  '[]'::jsonb
);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is((public.finalize_field_availability_import_job('11111111-3333-3333-3333-777777777771','[]'::jsonb)->>'inserted_profiles')::int,1,'availability import inserts profile');
SELECT is((SELECT count(*) FROM public.field_availability_profile_formats)::int,2,'multi-format rows stored');
SELECT is((SELECT count(*) FROM public.field_blackout_windows)::int,1,'blackout rows stored');
SELECT is((SELECT count(*) FROM public.field_equipment_requirements)::int,1,'equipment blockers stored');
SELECT is((SELECT count(*) FROM public.practice_slots WHERE organization_id='a1111111-1111-1111-1111-111111111111')::int,0,'no fabricated practice slots');

SELECT throws_ok($$ SELECT public.finalize_field_import_job('11111111-3333-3333-3333-777777777771','[]'::jsonb) $$,'22023',NULL,'legacy field finalizer unchanged for job type');

SELECT is((public.rollback_field_availability_import_job('11111111-3333-3333-3333-777777777771')->>'deleted_profiles')::int,1,'availability rollback deletes profiles');
SELECT is((SELECT count(*) FROM public.field_availability_profiles)::int,0,'profile table empty after rollback');

SELECT * FROM finish();
ROLLBACK;
