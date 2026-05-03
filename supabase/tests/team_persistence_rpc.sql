-- pgTAP: team persistence RPC is current-schema compatible, org-scoped, and
-- treats submitted team rosters as authoritative for the teams in the payload.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(17);

INSERT INTO public.players (id, organization_id, division_id, first_name, last_name)
VALUES
    (
        'a1111111-1111-1111-1111-00000000a001',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-11111111abcd',
        'Ava',
        'Admin'
    ),
    (
        'a1111111-1111-1111-1111-00000000a002',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-11111111abcd',
        'Amir',
        'Admin'
    ),
    (
        'a1111111-1111-1111-1111-00000000a003',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-11111111abcd',
        'Ana',
        'Admin'
    ),
    (
        'b2222222-2222-2222-2222-00000000b001',
        'b2222222-2222-2222-2222-222222222222',
        'b2222222-2222-2222-2222-22222222bcde',
        'Ben',
        'Bob'
    )
ON CONFLICT (id) DO NOTHING;

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}';

SELECT is(
    public.persist_team_schedule(
        jsonb_build_object(
            'id', 'a1111111-1111-1111-1111-00000000ea01',
            'organization_id', 'a1111111-1111-1111-1111-111111111111',
            'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
            'run_type', 'team',
            'status', 'completed',
            'parameters', jsonb_build_object('source', 'pgtap'),
            'metrics', jsonb_build_object('updatedTeams', 1),
            'results', jsonb_build_object('team_count', 1)
        ),
        jsonb_build_array(jsonb_build_object(
            'id', 'aaaaaaaa-0000-0000-0000-000000000001',
            'organization_id', 'a1111111-1111-1111-1111-111111111111',
            'division_id', 'a1111111-1111-1111-1111-11111111abcd',
            'name', 'A-Team Updated'
        )),
        jsonb_build_array(
            jsonb_build_object(
                'team_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                'player_id', 'a1111111-1111-1111-1111-00000000a001',
                'role', 'captain',
                'source', 'locked'
            ),
            jsonb_build_object(
                'team_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                'player_id', 'a1111111-1111-1111-1111-00000000a002',
                'role', 'player',
                'source', 'auto'
            )
        )
    )::text,
    'a1111111-1111-1111-1111-00000000ea01',
    'persist_team_schedule returns the scheduler run id'
);

SELECT is(
    (
        SELECT organization_id::text
        FROM public.scheduler_runs
        WHERE id = 'a1111111-1111-1111-1111-00000000ea01'
    ),
    'a1111111-1111-1111-1111-111111111111',
    'scheduler run is persisted under the current organization'
);

SELECT is(
    (
        SELECT created_by::text
        FROM public.scheduler_runs
        WHERE id = 'a1111111-1111-1111-1111-00000000ea01'
    ),
    '11111111-1111-1111-1111-111111111111',
    'authenticated callers cannot spoof the scheduler run creator'
);

SELECT is(
    (
        SELECT name
        FROM public.teams
        WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'
    ),
    'A-Team Updated',
    'team row is upserted under the current schema'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.team_players
        WHERE team_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    )::int,
    2,
    'team roster rows are inserted'
);

SELECT is(
    (
        SELECT source::text
        FROM public.team_players
        WHERE team_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          AND player_id = 'a1111111-1111-1111-1111-00000000a001'
    ),
    'manual',
    'locked team-player rows are normalized to manual source'
);

SELECT lives_ok(
    $$
        SELECT public.persist_team_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000ea01',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'team',
                'status', 'completed'
            ),
            jsonb_build_array(jsonb_build_object(
                'id', 'aaaaaaaa-0000-0000-0000-000000000001',
                'division_id', 'a1111111-1111-1111-1111-11111111abcd',
                'name', 'A-Team Updated'
            )),
            jsonb_build_array(
                jsonb_build_object(
                    'team_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                    'player_id', 'a1111111-1111-1111-1111-00000000a001',
                    'role', 'captain',
                    'source', 'manual'
                ),
                jsonb_build_object(
                    'team_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                    'player_id', 'a1111111-1111-1111-1111-00000000a002',
                    'role', 'player',
                    'source', 'auto'
                )
            )
        )
    $$,
    're-running the same team snapshot is idempotent'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.team_players
        WHERE team_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    )::int,
    2,
    'idempotent re-run does not duplicate team-player rows'
);

SELECT is(
    public.persist_team_schedule(
        jsonb_build_object(
            'id', 'a1111111-1111-1111-1111-00000000ea02',
            'organization_id', 'a1111111-1111-1111-1111-111111111111',
            'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
            'run_type', 'team',
            'status', 'completed'
        ),
        jsonb_build_array(jsonb_build_object(
            'id', 'aaaaaaaa-0000-0000-0000-000000000001',
            'division_id', 'a1111111-1111-1111-1111-11111111abcd',
            'name', 'A-Team Updated'
        )),
        jsonb_build_array(jsonb_build_object(
            'team_id', 'aaaaaaaa-0000-0000-0000-000000000001',
            'player_id', 'a1111111-1111-1111-1111-00000000a001',
            'role', 'captain',
            'source', 'manual'
        ))
    )::text,
    'a1111111-1111-1111-1111-00000000ea02',
    'later persisted team snapshots return the new scheduler run id'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.team_players
        WHERE team_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    )::int,
    1,
    'submitted roster is authoritative for teams in the payload'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333","app_metadata":{"role":"coach"}}';

SELECT throws_ok(
    $$
        SELECT public.persist_team_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000ea03',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'team',
                'status', 'completed'
            ),
            '[]'::jsonb,
            '[]'::jsonb
        )
    $$,
    '42501',
    NULL,
    'org members without admin role cannot persist team schedules'
);

RESET ROLE;
SET LOCAL role = 'service_role';
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT throws_ok(
    $$
        SELECT public.persist_team_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000ea04',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'team',
                'status', 'completed'
            ),
            jsonb_build_array(jsonb_build_object(
                'id', 'aaaaaaaa-0000-0000-0000-000000000004',
                'division_id', 'b2222222-2222-2222-2222-22222222bcde',
                'name', 'Wrong Division Team'
            )),
            '[]'::jsonb
        )
    $$,
    '42501',
    NULL,
    'RPC rejects teams whose division belongs to another organization'
);

SELECT throws_ok(
    $$
        SELECT public.persist_team_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000ea05',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'team',
                'status', 'completed'
            ),
            jsonb_build_array(jsonb_build_object(
                'id', 'aaaaaaaa-0000-0000-0000-000000000004',
                'division_id', 'a1111111-1111-1111-1111-11111111abcd',
                'name', 'A-Team 2'
            )),
            jsonb_build_array(jsonb_build_object(
                'team_id', 'aaaaaaaa-0000-0000-0000-000000000004',
                'player_id', 'b2222222-2222-2222-2222-00000000b001',
                'source', 'auto'
            ))
        )
    $$,
    '42501',
    NULL,
    'RPC rejects team-player rows whose player belongs to another organization'
);

SELECT throws_ok(
    $$
        SELECT public.persist_team_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000ea06',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'b2222222-2222-2222-2222-222222222bbb',
                'run_type', 'team',
                'status', 'completed'
            ),
            '[]'::jsonb,
            '[]'::jsonb
        )
    $$,
    '42501',
    NULL,
    'RPC rejects season settings from another organization'
);

SELECT throws_ok(
    $$
        SELECT public.persist_team_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000ea07',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'practice',
                'status', 'completed'
            ),
            '[]'::jsonb,
            '[]'::jsonb
        )
    $$,
    '22023',
    NULL,
    'RPC rejects invalid run types'
);

SELECT throws_ok(
    $$
        SELECT public.persist_team_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000ea08',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'team',
                'status', 'completed'
            ),
            jsonb_build_array(jsonb_build_object(
                'id', 'bbbbbbbb-0000-0000-0000-000000000002',
                'division_id', 'a1111111-1111-1111-1111-11111111abcd',
                'name', 'Spoofed Team'
            )),
            '[]'::jsonb
        )
    $$,
    '42501',
    NULL,
    'RPC rejects existing team ids from another organization'
);

SELECT is(
    public.persist_team_schedule(
        jsonb_build_object(
            'id', 'a1111111-1111-1111-1111-00000000ea09',
            'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
            'run_type', 'team',
            'status', 'completed'
        ),
        '[]'::jsonb,
        '[]'::jsonb
    )::text,
    'a1111111-1111-1111-1111-00000000ea09',
    'RPC can derive organization from season settings'
);

SELECT * FROM finish();

ROLLBACK;
