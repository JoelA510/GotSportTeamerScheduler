-- pgTAP: game persistence RPC is current-schema compatible and org-scoped.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(17);

INSERT INTO public.teams (id, organization_id, division_id, name)
VALUES
    (
        'aaaaaaaa-0000-0000-0000-000000000003',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-11111111abcd',
        'A-Team 2'
    )
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.locations (id, organization_id, name)
VALUES
    (
        'a1111111-1111-1111-1111-00000000f101',
        'a1111111-1111-1111-1111-111111111111',
        'Org A Game Complex'
    ),
    (
        'b2222222-2222-2222-2222-00000000f102',
        'b2222222-2222-2222-2222-222222222222',
        'Org B Game Complex'
    );

INSERT INTO public.fields (id, organization_id, location_id, name)
VALUES
    (
        'a1111111-1111-1111-1111-00000000fa11',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-00000000f101',
        'Org A Game Field 1'
    ),
    (
        'b2222222-2222-2222-2222-00000000fb12',
        'b2222222-2222-2222-2222-222222222222',
        'b2222222-2222-2222-2222-00000000f102',
        'Org B Game Field 1'
    );

INSERT INTO public.game_slots (
    id,
    organization_id,
    field_id,
    division_id,
    start,
    "end",
    slot_date,
    start_time,
    end_time,
    week_index,
    capacity
)
VALUES
    (
        'a1111111-1111-1111-1111-00000000ca01',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-00000000fa11',
        'a1111111-1111-1111-1111-11111111abcd',
        '2026-04-04T08:00:00Z',
        '2026-04-04T09:00:00Z',
        '2026-04-04',
        '08:00',
        '09:00',
        1,
        1
    ),
    (
        'b2222222-2222-2222-2222-00000000cb02',
        'b2222222-2222-2222-2222-222222222222',
        'b2222222-2222-2222-2222-00000000fb12',
        'b2222222-2222-2222-2222-22222222bcde',
        '2026-04-04T08:00:00Z',
        '2026-04-04T09:00:00Z',
        '2026-04-04',
        '08:00',
        '09:00',
        1,
        1
    );

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    public.persist_game_schedule(
        jsonb_build_object(
            'id', 'a1111111-1111-1111-1111-00000000da01',
            'organization_id', 'a1111111-1111-1111-1111-111111111111',
            'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
            'run_type', 'game',
            'status', 'completed',
            'parameters', jsonb_build_object('source', 'pgtap'),
            'metrics', '{}'::jsonb,
            'results', jsonb_build_object('assignment_count', 1)
        ),
        jsonb_build_array(jsonb_build_object(
            'home_team_id', 'aaaaaaaa-0000-0000-0000-000000000001',
            'away_team_id', 'aaaaaaaa-0000-0000-0000-000000000003',
            'game_slot_id', 'a1111111-1111-1111-1111-00000000ca01',
            'field_id', 'a1111111-1111-1111-1111-00000000fa11',
            'division', 'Org A U10',
            'week_index', 1,
            'start', '2026-04-04T08:00:00Z',
            'end', '2026-04-04T09:00:00Z',
            'source', 'locked'
        ))
    )::text,
    'a1111111-1111-1111-1111-00000000da01',
    'persist_game_schedule returns the scheduler run id'
);

SELECT is(
    (
        SELECT organization_id::text
        FROM public.scheduler_runs
        WHERE id = 'a1111111-1111-1111-1111-00000000da01'
    ),
    'a1111111-1111-1111-1111-111111111111',
    'scheduler run is persisted under the current organization'
);

SELECT is(
    (
        SELECT created_by::text
        FROM public.scheduler_runs
        WHERE id = 'a1111111-1111-1111-1111-00000000da01'
    ),
    '11111111-1111-1111-1111-111111111111',
    'authenticated callers cannot spoof the scheduler run creator'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.game_assignments
        WHERE home_team_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          AND away_team_id = 'aaaaaaaa-0000-0000-0000-000000000003'
          AND game_slot_id = 'a1111111-1111-1111-1111-00000000ca01'
          AND week_index = 1
    )::int,
    1,
    'game assignment is inserted once'
);

SELECT is(
    (
        SELECT assignment_source::text
        FROM public.game_assignments
        WHERE home_team_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          AND away_team_id = 'aaaaaaaa-0000-0000-0000-000000000003'
          AND game_slot_id = 'a1111111-1111-1111-1111-00000000ca01'
          AND week_index = 1
    ),
    'manual',
    'locked assignments are normalized to manual source'
);

SELECT is(
    (
        SELECT run_id::text
        FROM public.game_assignments
        WHERE home_team_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          AND away_team_id = 'aaaaaaaa-0000-0000-0000-000000000003'
          AND game_slot_id = 'a1111111-1111-1111-1111-00000000ca01'
          AND week_index = 1
    ),
    'a1111111-1111-1111-1111-00000000da01',
    'game assignment is linked to the persisted scheduler run'
);

SELECT lives_ok(
    $$
        SELECT public.persist_game_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000da01',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'game',
                'status', 'completed'
            ),
            jsonb_build_array(jsonb_build_object(
                'home_team_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                'away_team_id', 'aaaaaaaa-0000-0000-0000-000000000003',
                'slot_id', 'a1111111-1111-1111-1111-00000000ca01',
                'week_index', 1,
                'start', '2026-04-04T08:00:00Z',
                'end', '2026-04-04T09:00:00Z',
                'source', 'manual'
            ))
        )
    $$,
    're-running the same game snapshot is idempotent'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.game_assignments
        WHERE home_team_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          AND away_team_id = 'aaaaaaaa-0000-0000-0000-000000000003'
          AND game_slot_id = 'a1111111-1111-1111-1111-00000000ca01'
          AND week_index = 1
    )::int,
    1,
    'idempotent re-run does not duplicate the assignment'
);

SELECT is(
    public.persist_game_schedule(
        jsonb_build_object(
            'id', 'a1111111-1111-1111-1111-00000000da02',
            'organization_id', 'a1111111-1111-1111-1111-111111111111',
            'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
            'run_type', 'game',
            'status', 'completed'
        ),
        jsonb_build_array(jsonb_build_object(
            'homeTeamId', 'aaaaaaaa-0000-0000-0000-000000000001',
            'awayTeamId', 'aaaaaaaa-0000-0000-0000-000000000003',
            'slotId', 'a1111111-1111-1111-1111-00000000ca01',
            'weekIndex', 1,
            'start', '2026-04-04T08:00:00Z',
            'end', '2026-04-04T09:00:00Z',
            'source', 'auto'
        ))
    )::text,
    'a1111111-1111-1111-1111-00000000da02',
    'later persisted snapshots accept camelCase payloads and return the new run id'
);

SELECT is(
    (
        SELECT run_id::text
        FROM public.game_assignments
        WHERE home_team_id = 'aaaaaaaa-0000-0000-0000-000000000001'
          AND away_team_id = 'aaaaaaaa-0000-0000-0000-000000000003'
          AND game_slot_id = 'a1111111-1111-1111-1111-00000000ca01'
          AND week_index = 1
    ),
    'a1111111-1111-1111-1111-00000000da02',
    'idempotent assignment upsert re-links to the latest persisted scheduler run'
);

RESET ROLE;
SET LOCAL role = 'service_role';
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT throws_ok(
    $$
        SELECT public.persist_game_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000de01',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'game',
                'status', 'completed'
            ),
            jsonb_build_array(jsonb_build_object(
                'home_team_id', 'bbbbbbbb-0000-0000-0000-000000000002',
                'away_team_id', 'aaaaaaaa-0000-0000-0000-000000000003',
                'game_slot_id', 'a1111111-1111-1111-1111-00000000ca01',
                'week_index', 1,
                'start', '2026-04-04T08:00:00Z',
                'end', '2026-04-04T09:00:00Z',
                'source', 'auto'
            ))
        )
    $$,
    '42501',
    NULL,
    'RPC rejects assignments whose home team belongs to another organization'
);

SELECT throws_ok(
    $$
        SELECT public.persist_game_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000de02',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'game',
                'status', 'completed'
            ),
            jsonb_build_array(jsonb_build_object(
                'home_team_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                'away_team_id', 'bbbbbbbb-0000-0000-0000-000000000002',
                'game_slot_id', 'a1111111-1111-1111-1111-00000000ca01',
                'week_index', 1,
                'start', '2026-04-04T08:00:00Z',
                'end', '2026-04-04T09:00:00Z',
                'source', 'auto'
            ))
        )
    $$,
    '42501',
    NULL,
    'RPC rejects assignments whose away team belongs to another organization'
);

SELECT throws_ok(
    $$
        SELECT public.persist_game_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000de03',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'game',
                'status', 'completed'
            ),
            jsonb_build_array(jsonb_build_object(
                'home_team_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                'away_team_id', 'aaaaaaaa-0000-0000-0000-000000000003',
                'game_slot_id', 'b2222222-2222-2222-2222-00000000cb02',
                'week_index', 1,
                'start', '2026-04-04T08:00:00Z',
                'end', '2026-04-04T09:00:00Z',
                'source', 'auto'
            ))
        )
    $$,
    '42501',
    NULL,
    'RPC rejects assignments whose game slot belongs to another organization'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222"}';

SELECT throws_ok(
    $$
        SELECT public.persist_game_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000de04',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'game',
                'status', 'completed'
            ),
            '[]'::jsonb
        )
    $$,
    '42501',
    NULL,
    'Org B user cannot persist an Org A game run'
);

RESET ROLE;
SET LOCAL role = 'service_role';
SET LOCAL "request.jwt.claims" TO '{"role":"service_role"}';

SELECT throws_ok(
    $$
        SELECT public.persist_game_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000de05',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'b2222222-2222-2222-2222-222222222bbb',
                'run_type', 'game',
                'status', 'completed'
            ),
            '[]'::jsonb
        )
    $$,
    '42501',
    NULL,
    'season/org mismatch fails'
);

SELECT throws_ok(
    $$
        SELECT public.persist_game_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000de06',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'practice',
                'status', 'completed'
            ),
            '[]'::jsonb
        )
    $$,
    '22023',
    NULL,
    'invalid run type fails'
);

SELECT throws_ok(
    $$
        SELECT public.persist_game_schedule(
            jsonb_build_object(
                'id', 'a1111111-1111-1111-1111-00000000de07',
                'organization_id', 'a1111111-1111-1111-1111-111111111111',
                'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
                'run_type', 'game',
                'status', 'completed'
            ),
            jsonb_build_array(jsonb_build_object(
                'home_team_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                'away_team_id', 'aaaaaaaa-0000-0000-0000-000000000001',
                'game_slot_id', 'a1111111-1111-1111-1111-00000000ca01',
                'week_index', 1,
                'start', '2026-04-04T08:00:00Z',
                'end', '2026-04-04T09:00:00Z',
                'source', 'auto'
            ))
        )
    $$,
    '22023',
    NULL,
    'same team assignments fail'
);

SELECT * FROM finish();

ROLLBACK;
