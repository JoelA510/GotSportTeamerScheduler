-- pgTAP: division team-generation settings are upserted through an admin RPC.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(15);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (public.admin_upsert_division_settings(
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-111111111aaa',
        NULL,
        'Org A U12',
        14,
        10,
        12,
        2,
        1,
        3
    )->>'changed'),
    'true',
    'Org A admin can insert division settings through the RPC'
);

SELECT results_eq(
    $$
        SELECT organization_id,
               season_settings_id,
               name,
               max_roster_size,
               min_roster_size,
               target_team_size,
               team_count_override,
               min_teams,
               max_teams
          FROM public.divisions
         WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
           AND season_settings_id = 'a1111111-1111-1111-1111-111111111aaa'
           AND name = 'Org A U12'
    $$,
    $$
        VALUES (
            'a1111111-1111-1111-1111-111111111111'::uuid,
            'a1111111-1111-1111-1111-111111111aaa'::uuid,
            'Org A U12'::text,
            14,
            10,
            12,
            2,
            1,
            3
        )
    $$,
    'inserted division settings persist on the division row'
);

SELECT is(
    (
        SELECT count(*)
          FROM public.audit_log
         WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
           AND action = 'settings.updated'
           AND resource_type = 'division'
           AND metadata->>'setting' = 'division_team_generation_rules'
    )::integer,
    1,
    'inserting division settings writes one settings audit row'
);

SELECT is(
    (public.admin_upsert_division_settings(
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-111111111aaa',
        NULL,
        'Org A U12',
        14,
        10,
        12,
        2,
        1,
        3
    )->>'changed'),
    'false',
    'repeating the same division settings upsert is idempotent'
);

SELECT is(
    (
        SELECT count(*)
          FROM public.divisions
         WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
           AND season_settings_id = 'a1111111-1111-1111-1111-111111111aaa'
           AND name = 'Org A U12'
    )::integer,
    1,
    'idempotent upsert does not duplicate the division row'
);

SELECT is(
    (
        SELECT count(*)
          FROM public.audit_log
         WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
           AND action = 'settings.updated'
           AND resource_type = 'division'
           AND metadata->>'setting' = 'division_team_generation_rules'
    )::integer,
    1,
    'idempotent upsert does not add a duplicate audit row'
);

SELECT is(
    (public.admin_upsert_division_settings(
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-111111111aaa',
        'a1111111-1111-1111-1111-11111111abcd',
        'Org A U10',
        16,
        9,
        11,
        3,
        2,
        4
    )->>'changed'),
    'true',
    'Org A admin can update an existing division settings row by id'
);

SELECT results_eq(
    $$
        SELECT max_roster_size, min_roster_size, target_team_size,
               team_count_override, min_teams, max_teams
          FROM public.divisions
         WHERE id = 'a1111111-1111-1111-1111-11111111abcd'
    $$,
    $$ VALUES (16, 9, 11, 3, 2, 4) $$,
    'existing division settings update through the RPC'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_division_settings(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-111111111aaa',
            NULL,
            'Coach Created U14',
            14,
            10,
            12,
            NULL,
            NULL,
            NULL
        )
    $$,
    '42501',
    NULL,
    'Org A coach cannot upsert division settings'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222"}';

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_division_settings(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-111111111aaa',
            'a1111111-1111-1111-1111-11111111abcd',
            'Org A U10',
            14,
            10,
            12,
            NULL,
            NULL,
            NULL
        )
    $$,
    '42501',
    NULL,
    'Org B admin cannot update Org A division settings'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_division_settings(
            'a1111111-1111-1111-1111-111111111111',
            'b2222222-2222-2222-2222-222222222bbb',
            NULL,
            'Wrong Season',
            14,
            10,
            12,
            NULL,
            NULL,
            NULL
        )
    $$,
    '42501',
    NULL,
    'season settings must belong to the requested organization'
);

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_division_settings(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-111111111aaa',
            'b2222222-2222-2222-2222-22222222bcde',
            'Org B U10',
            14,
            10,
            12,
            NULL,
            NULL,
            NULL
        )
    $$,
    '42501',
    NULL,
    'cross-org division id is rejected'
);

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_division_settings(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-111111111aaa',
            NULL,
            'Invalid Roster Bounds',
            10,
            15,
            12,
            NULL,
            NULL,
            NULL
        )
    $$,
    '23514',
    NULL,
    'database rejects min roster greater than max roster through the RPC'
);

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_division_settings(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-111111111aaa',
            NULL,
            'Invalid Team Bounds',
            14,
            10,
            12,
            5,
            1,
            3
        )
    $$,
    '23514',
    NULL,
    'database rejects team count override above max teams through the RPC'
);

SELECT throws_ok(
    $$
        SELECT public.admin_upsert_division_settings(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-111111111aaa',
            NULL,
            '',
            14,
            10,
            12,
            NULL,
            NULL,
            NULL
        )
    $$,
    '23502',
    NULL,
    'new division settings require a name'
);

SELECT * FROM finish();
ROLLBACK;
