BEGIN;
\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(13);

INSERT INTO public.field_availability_scenarios (id, organization_id, season_label, name, exclusivity_group, is_active)
VALUES
('70000000-0000-0000-0000-000000000001','a1111111-1111-1111-1111-111111111111','Fall 2026','Canyon Potential','canyon',false),
('70000000-0000-0000-0000-000000000002','a1111111-1111-1111-1111-111111111111','Fall 2026','Canyon Approved','canyon',false),
('70000000-0000-0000-0000-000000000003','a1111111-1111-1111-1111-111111111111','Fall 2026','Lights Potential','lights',false),
('70000000-0000-0000-0000-000000000004','a1111111-1111-1111-1111-111111111111','Fall 2026','Lights Approved','lights',false),
('70000000-0000-0000-0000-000000000005','b1111111-1111-1111-1111-111111111111','Fall 2026','Other Org Canyon','canyon',false);

INSERT INTO public.field_availability_scenario_members (organization_id, scenario_id, profile_id, membership_status)
VALUES
('a1111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-000000000001','60111111-0000-0000-0000-000000000001','included'),
('a1111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-000000000002','60111111-0000-0000-0000-000000000002','included'),
('a1111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-000000000003','60111111-0000-0000-0000-000000000003','included'),
('a1111111-1111-1111-1111-111111111111','70000000-0000-0000-0000-000000000004','60111111-0000-0000-0000-000000000004','included');

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is((public.admin_select_field_availability_scenario('a1111111-1111-1111-1111-111111111111','Fall 2026','canyon','70000000-0000-0000-0000-000000000001')->>'active_scenario_id')::uuid,'70000000-0000-0000-0000-000000000001'::uuid,'admin can select initial active scenario');
SELECT is((SELECT count(*) FROM public.field_availability_scenarios WHERE organization_id='a1111111-1111-1111-1111-111111111111' AND season_label='Fall 2026' AND exclusivity_group='canyon' AND is_active)::int,1,'exactly one canyon scenario active after initial selection');

SELECT is((public.admin_select_field_availability_scenario('a1111111-1111-1111-1111-111111111111','Fall 2026','canyon','70000000-0000-0000-0000-000000000002')->>'previous_active_scenario_id')::uuid,'70000000-0000-0000-0000-000000000001'::uuid,'selecting another scenario reports previous active scenario');
SELECT is((SELECT id FROM public.field_availability_scenarios WHERE organization_id='a1111111-1111-1111-1111-111111111111' AND season_label='Fall 2026' AND exclusivity_group='canyon' AND is_active),'70000000-0000-0000-0000-000000000002'::uuid,'selecting another scenario supersedes prior active scenario');

SELECT is((public.admin_select_field_availability_scenario('a1111111-1111-1111-1111-111111111111','Fall 2026','canyon','70000000-0000-0000-0000-000000000002')->>'status'),'no_op','re-selecting same active scenario is idempotent');
SELECT is((SELECT count(*) FROM public.audit_log WHERE organization_id='a1111111-1111-1111-1111-111111111111' AND resource_type='field_availability_scenario' AND action='settings.updated')::int,2,'audit written only for state-changing selections');

SELECT throws_ok($$ SELECT public.admin_select_field_availability_scenario('a1111111-1111-1111-1111-111111111111','Fall 2026','canyon','70000000-0000-0000-0000-000000000005') $$,'P0002',NULL,'cross-org scenario selection blocked');

SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';
SELECT throws_ok($$ SELECT public.admin_select_field_availability_scenario('a1111111-1111-1111-1111-111111111111','Fall 2026','canyon','70000000-0000-0000-0000-000000000001') $$,'42501',NULL,'non-admin blocked');

SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';
SELECT is((public.admin_select_field_availability_scenario('a1111111-1111-1111-1111-111111111111','Fall 2026','lights','70000000-0000-0000-0000-000000000003')->>'active_scenario_id')::uuid,'70000000-0000-0000-0000-000000000003'::uuid,'different exclusivity group can have its own active scenario');
SELECT is((SELECT count(*) FROM public.field_availability_scenarios WHERE organization_id='a1111111-1111-1111-1111-111111111111' AND season_label='Fall 2026' AND exclusivity_group='canyon' AND is_active)::int,1,'canyon group remains with one active scenario');
SELECT is((SELECT count(*) FROM public.field_availability_scenarios WHERE organization_id='a1111111-1111-1111-1111-111111111111' AND season_label='Fall 2026' AND exclusivity_group='lights' AND is_active)::int,1,'lights group has one active scenario');

SELECT is((SELECT count(*) FROM public.get_field_availability_scenarios('a1111111-1111-1111-1111-111111111111','Fall 2026'))::int,4,'admin helper returns scenarios for org/season');
SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';
SELECT throws_ok($$ SELECT * FROM public.get_field_availability_scenarios('a1111111-1111-1111-1111-111111111111','Fall 2026') $$,'42501',NULL,'non-admin blocked from helper');

SELECT * FROM finish();
ROLLBACK;
