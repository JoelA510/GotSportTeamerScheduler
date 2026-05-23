BEGIN;
\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(14);

INSERT INTO public.import_jobs (id, organization_id, job_type, storage_path, status, created_by, total_rows)
VALUES
('11111111-3333-3333-3333-777777777771','a1111111-1111-1111-1111-111111111111','field_availability','orga/fall2026.csv','importing','11111111-1111-1111-1111-111111111111',9),
('11111111-3333-3333-3333-777777777772','b1111111-1111-1111-1111-111111111111','field_availability','orgb/fall2026.csv','importing','22222222-2222-2222-2222-222222222222',1);

INSERT INTO public.staging_import_rows (organization_id, import_job_id, import_type, source_row_number, raw_payload, normalized_payload, validation_errors)
VALUES
('a1111111-1111-1111-1111-111111111111','11111111-3333-3333-3333-777777777771','field_availability',1,'{}',jsonb_build_object('season_label','Fall 2026','location','San Lorenzo','field_name','SL Main','available_from','2026-08-01','available_until','2026-10-31','blackout_months','Sep','record_status','active','approval_status','approved','primary_format','11V11'),'[]'::jsonb),
('a1111111-1111-1111-1111-111111111111','11111111-3333-3333-3333-777777777771','field_availability',2,'{}',jsonb_build_object('season_label','Fall 2026','location','Five Canyons','field_name','Upper','available_from','2026-09-01','available_until','2026-11-30','blackout_months','Aug','record_status','active'),'[]'::jsonb),
('a1111111-1111-1111-1111-111111111111','11111111-3333-3333-3333-777777777771','field_availability',3,'{}',jsonb_build_object('season_label','Fall 2026','location','Bret Harte','field_name','Main','available_from','2026-09-01','available_until','2026-11-30','blackout_months','Aug'),'[]'::jsonb),
('a1111111-1111-1111-1111-111111111111','11111111-3333-3333-3333-777777777771','field_availability',4,'{}',jsonb_build_object('season_label','Fall 2026','location','Creekside','field_name','Field 1','available_from','2026-08-01','available_until','2026-11-30','record_status','excluded'),'[]'::jsonb),
('a1111111-1111-1111-1111-111111111111','11111111-3333-3333-3333-777777777771','field_availability',5,'{}',jsonb_build_object('season_label','Fall 2026','location','Proctor','field_name','Field 1','available_from','2026-08-01','available_until','2026-11-30','record_status','excluded'),'[]'::jsonb),
('a1111111-1111-1111-1111-111111111111','11111111-3333-3333-3333-777777777771','field_availability',6,'{}',jsonb_build_object('season_label','Fall 2026','location','Canyon','field_name','Potential','available_from','2026-08-01','available_until','2026-11-30','record_status','potential'),'[]'::jsonb),
('a1111111-1111-1111-1111-111111111111','11111111-3333-3333-3333-777777777771','field_availability',7,'{}',jsonb_build_object('season_label','Fall 2026','location','Jensen','field_name','Main','available_from','2026-08-01','available_until','2026-11-30','goal_status','not approved'),'[]'::jsonb),
('a1111111-1111-1111-1111-111111111111','11111111-3333-3333-3333-777777777771','field_availability',8,'{}',jsonb_build_object('season_label','Fall 2026','location','Jensen','field_name','Aux','available_from','2026-08-01','available_until','2026-11-30','goal_status','needs sturdy goals'),'[]'::jsonb),
('a1111111-1111-1111-1111-111111111111','11111111-3333-3333-3333-777777777771','field_availability',9,'{}',jsonb_build_object('season_label','Fall 2026','location','Bad','field_name','Bad','available_from','2026-11-30','available_until','2026-08-01','format_quantity','0'),'[]'::jsonb);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is((public.finalize_field_availability_import_job('11111111-3333-3333-3333-777777777771','[]'::jsonb)->>'invalid_rows')::int,1,'invalid capacity/date row becomes warning');
SELECT is((SELECT status FROM public.import_jobs WHERE id='11111111-3333-3333-3333-777777777771'),'completed_with_warnings','job status completed_with_warnings');
SELECT is((SELECT count(*) FROM public.field_blackout_windows WHERE blackout_from='2026-09-01')::int,1,'San Lorenzo has September blackout only');
SELECT is((SELECT count(*) FROM public.field_availability_profiles WHERE location='Five Canyons' AND field_name='Upper' AND available_from='2026-09-01')::int,1,'Five Canyons Upper starts September');
SELECT is((SELECT count(*) FROM public.field_availability_profiles WHERE location='Bret Harte' AND available_from='2026-09-01')::int,1,'Bret Harte starts September');
SELECT is((SELECT count(*) FROM public.field_availability_profiles WHERE location IN ('Creekside','Proctor') AND record_status='active')::int,0,'exclusions do not become active');
SELECT is((SELECT count(*) FROM public.field_availability_profiles WHERE location='Canyon' AND record_status='potential' AND approval_status='pending')::int,1,'potential rows remain potential/pending');
SELECT is((SELECT requirement_status FROM public.field_equipment_requirements fer JOIN public.field_availability_profiles p ON p.id=fer.profile_id WHERE p.location='Jensen' AND p.field_name='Main' LIMIT 1),'not_approved','not approved goal normalizes');
SELECT is((SELECT requirement_status FROM public.field_equipment_requirements fer JOIN public.field_availability_profiles p ON p.id=fer.profile_id WHERE p.location='Jensen' AND p.field_name='Aux' LIMIT 1),'needs_purchase','needs sturdy goals normalizes');

SELECT throws_ok($$ SELECT public.finalize_field_availability_import_job('11111111-3333-3333-3333-777777777772','[]'::jsonb) $$,'42501',NULL,'org isolation enforced for finalize');
SELECT throws_ok($$ SELECT public.finalize_field_import_job('11111111-3333-3333-3333-777777777771','[]'::jsonb) $$,'22023',NULL,'legacy finalizer rejects availability jobs');
SELECT is((SELECT count(*) FROM public.practice_slots WHERE organization_id='a1111111-1111-1111-1111-111111111111')::int,0,'no practice slot creation');
SELECT is((public.rollback_field_availability_import_job('11111111-3333-3333-3333-777777777771')->>'deleted_profiles')::int,8,'rollback deletes imported profiles');
SELECT is((SELECT count(*) FROM public.import_application_records WHERE import_job_id='11111111-3333-3333-3333-777777777771' AND rolled_back_at IS NOT NULL)::int > 0, true, 'rollback marks ledger rows');

SELECT * FROM finish();
ROLLBACK;
