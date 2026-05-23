-- pgTAP: team portal medical status is season-scoped and role-scoped.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(10);

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
VALUES
    (
        '44444444-4444-4444-4444-444444444444',
        'pat-parent@test.local',
        jsonb_build_object('full_name', 'Pat Parent', 'password_length', 12),
        'authenticated',
        'authenticated'
    ),
    (
        '55555555-5555-5555-5555-555555555555',
        'una-coach@test.local',
        jsonb_build_object('full_name', 'Una Coach', 'password_length', 12),
        'authenticated',
        'authenticated'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name)
VALUES
    ('44444444-4444-4444-4444-444444444444', 'pat-parent@test.local', 'Pat Parent'),
    ('55555555-5555-5555-5555-555555555555', 'una-coach@test.local', 'Una Coach')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members (organization_id, profile_id, role)
VALUES
    ('a1111111-1111-1111-1111-111111111111', '44444444-4444-4444-4444-444444444444', 'parent'),
    ('a1111111-1111-1111-1111-111111111111', '55555555-5555-5555-5555-555555555555', 'coach')
ON CONFLICT (organization_id, profile_id) DO NOTHING;

INSERT INTO public.season_settings (id, organization_id, name, status, season_year)
VALUES
    (
        'a1111111-1111-1111-1111-1111111110d0',
        'a1111111-1111-1111-1111-111111111111',
        'Org A Old 2025',
        'completed',
        2025
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.coaches (
    id,
    organization_id,
    profile_id,
    user_id,
    full_name,
    email,
    status
)
VALUES
    (
        'a1111111-1111-1111-1111-00000000cc01',
        'a1111111-1111-1111-1111-111111111111',
        '33333333-3333-3333-3333-333333333333',
        '33333333-3333-3333-3333-333333333333',
        'Charlie Coach-A',
        'charlie-coach-a@example.com',
        'active'
    ),
    (
        'a1111111-1111-1111-1111-00000000cc02',
        'a1111111-1111-1111-1111-111111111111',
        '55555555-5555-5555-5555-555555555555',
        '55555555-5555-5555-5555-555555555555',
        'Una Unassigned',
        'una-unassigned@example.com',
        'active'
    )
ON CONFLICT (email) DO UPDATE SET
    profile_id = EXCLUDED.profile_id,
    user_id = EXCLUDED.user_id,
    status = EXCLUDED.status;

UPDATE public.teams
   SET coach_id = 'a1111111-1111-1111-1111-00000000cc01'
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

INSERT INTO public.players (id, organization_id, division_id, first_name, last_name)
VALUES
    (
        'a1111111-1111-1111-1111-00000000a101',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-11111111abcd',
        'Ava',
        'Roster'
    ),
    (
        'a1111111-1111-1111-1111-00000000a102',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-11111111abcd',
        'Ben',
        'Roster'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.team_players (team_id, player_id, organization_id)
VALUES
    (
        'aaaaaaaa-0000-0000-0000-000000000001',
        'a1111111-1111-1111-1111-00000000a101',
        'a1111111-1111-1111-1111-111111111111'
    ),
    (
        'aaaaaaaa-0000-0000-0000-000000000001',
        'a1111111-1111-1111-1111-00000000a102',
        'a1111111-1111-1111-1111-111111111111'
    )
ON CONFLICT (team_id, player_id) DO NOTHING;

INSERT INTO public.profile_players (profile_id, player_id, organization_id)
VALUES (
    '44444444-4444-4444-4444-444444444444',
    'a1111111-1111-1111-1111-00000000a101',
    'a1111111-1111-1111-1111-111111111111'
)
ON CONFLICT (profile_id, player_id) DO NOTHING;

INSERT INTO public.registration_forms (id, organization_id, title, season_id, status)
VALUES
    (
        'a1111111-1111-1111-1111-00000000f101',
        'a1111111-1111-1111-1111-111111111111',
        'Org A Current Registration',
        'a1111111-1111-1111-1111-111111111aaa',
        'open'
    ),
    (
        'a1111111-1111-1111-1111-00000000f102',
        'a1111111-1111-1111-1111-111111111111',
        'Org A Old Registration',
        'a1111111-1111-1111-1111-1111111110d0',
        'closed'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.registrations (
    id,
    organization_id,
    form_id,
    player_id,
    profile_id,
    medical_cleared,
    updated_at
)
VALUES
    (
        'a1111111-1111-1111-1111-00000000e101',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-00000000f101',
        'a1111111-1111-1111-1111-00000000a101',
        '44444444-4444-4444-4444-444444444444',
        false,
        '2026-04-02T00:00:00Z'
    ),
    (
        'a1111111-1111-1111-1111-00000000e102',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-00000000f101',
        'a1111111-1111-1111-1111-00000000a102',
        '44444444-4444-4444-4444-444444444444',
        true,
        '2026-04-03T00:00:00Z'
    ),
    (
        'a1111111-1111-1111-1111-00000000e103',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-00000000f102',
        'a1111111-1111-1111-1111-00000000a101',
        '44444444-4444-4444-4444-444444444444',
        true,
        '2026-04-04T00:00:00Z'
    )
ON CONFLICT (id) DO NOTHING;

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}';

SELECT is(
    (
        SELECT count(*)
        FROM public.get_team_portal_medical_status('aaaaaaaa-0000-0000-0000-000000000001')
    )::int,
    2,
    'Org admin can see medical status for the full team roster'
);

SELECT is(
    (
        SELECT medical_cleared
        FROM public.get_team_portal_medical_status('aaaaaaaa-0000-0000-0000-000000000001')
        WHERE player_id = 'a1111111-1111-1111-1111-00000000a101'
    ),
    false,
    'current-season pending status wins over an older cleared registration'
);

SELECT is(
    (
        SELECT medical_cleared
        FROM public.get_team_portal_medical_status('aaaaaaaa-0000-0000-0000-000000000001')
        WHERE player_id = 'a1111111-1111-1111-1111-00000000a102'
    ),
    true,
    'current-season cleared status is returned'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333","app_metadata":{"role":"coach"}}';

SELECT is(
    (
        SELECT count(*)
        FROM public.get_team_portal_medical_status('aaaaaaaa-0000-0000-0000-000000000001')
    )::int,
    0,
    'assigned coach does not receive full-roster medical status'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"55555555-5555-5555-5555-555555555555","app_metadata":{"role":"coach"}}';

SELECT is(
    (
        SELECT count(*)
        FROM public.get_team_portal_medical_status('aaaaaaaa-0000-0000-0000-000000000001')
    )::int,
    0,
    'unassigned coach cannot see roster medical status'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"44444444-4444-4444-4444-444444444444","app_metadata":{"role":"parent"}}';

SELECT is(
    (
        SELECT count(*)
        FROM public.get_team_portal_medical_status('aaaaaaaa-0000-0000-0000-000000000001')
    )::int,
    1,
    'parent can see medical status only for their own rostered player'
);

SELECT is(
    (
        SELECT player_id::text
        FROM public.get_team_portal_medical_status('aaaaaaaa-0000-0000-0000-000000000001')
    ),
    'a1111111-1111-1111-1111-00000000a101',
    'parent RPC result is limited to their linked child'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"role":"admin"}}';

SELECT throws_ok(
    $$
        SELECT public.get_team_portal_medical_status('aaaaaaaa-0000-0000-0000-000000000001')
    $$,
    '42501',
    NULL,
    'cross-org caller cannot read team medical status'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}';

SELECT throws_ok(
    $$ SELECT public.get_team_portal_medical_status(NULL::uuid) $$,
    '23502',
    NULL,
    'missing team id is rejected'
);

SELECT throws_ok(
    $$ SELECT public.get_team_portal_medical_status('99999999-9999-9999-9999-999999999999') $$,
    '23503',
    NULL,
    'unknown team id is rejected'
);

SELECT * FROM finish();
ROLLBACK;
