-- pgTAP: teaming re-run follow-ups (20260610000000_teaming_rerun_followups.sql)
-- Verifies the DB-side contract the JS round-trip test only simulates:
--   * persist_team_schedule sanitizes teams.assistant_coach_ids to coaches that
--     EXIST and belong to the run org (the column grants portal/RLS access);
--   * an absent assistant_coach_ids key preserves the stored value (COALESCE);
--   * get_latest_team_runs_per_division resolves division and skips empty runs.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(6);

-- Coaches: one same-org assistant (kept) and one cross-org coach (dropped).
INSERT INTO public.coaches (id, organization_id, full_name, email)
VALUES
    ('cccccccc-0000-4000-8000-00000000aa02', 'a1111111-1111-1111-1111-111111111111', 'Org A Assistant', 'asst-a@example.com'),
    ('dddddddd-0000-4000-8000-0000000bbb01', 'b2222222-2222-2222-2222-222222222222', 'Org B Coach', 'coach-b@example.com')
ON CONFLICT (id) DO NOTHING;

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111","app_metadata":{"role":"admin"}}';

-- 1. Persist a team whose assistant list mixes a same-org coach, an unknown uuid,
--    and a cross-org coach.
SELECT lives_ok(
    $$
    SELECT public.persist_team_schedule(
        jsonb_build_object(
            'id', 'aaaaaaaa-0000-4000-8000-000000000e01',
            'organization_id', 'a1111111-1111-1111-1111-111111111111',
            'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
            'run_type', 'team',
            'status', 'completed',
            'parameters', jsonb_build_object('selectedProgramId', 'U10'),
            'results', jsonb_build_object('teams', jsonb_build_array(
                jsonb_build_object('id', 'bbbbbbbb-0000-4000-8000-0000000000b1', 'division', 'U10')
            ))
        ),
        jsonb_build_array(jsonb_build_object(
            'id', 'bbbbbbbb-0000-4000-8000-0000000000b1',
            'division_id', 'a1111111-1111-1111-1111-11111111abcd',
            'name', 'Team Alpha',
            'assistant_coach_ids', jsonb_build_array(
                'cccccccc-0000-4000-8000-00000000aa02',
                'eeeeeeee-0000-4000-8000-00000000ff01',
                'dddddddd-0000-4000-8000-0000000bbb01'
            )
        )),
        '[]'::jsonb
    )
    $$,
    'persist accepts a team carrying mixed assistant ids'
);

-- 2. Only the same-org existing coach is stored; unknown + cross-org are dropped.
SELECT is(
    (SELECT assistant_coach_ids FROM public.teams WHERE id = 'bbbbbbbb-0000-4000-8000-0000000000b1'),
    ARRAY['cccccccc-0000-4000-8000-00000000aa02']::uuid[],
    'cross-org and unknown assistant ids are dropped; same-org coach kept'
);

-- 3. Re-persist the SAME team WITHOUT the assistant_coach_ids key.
SELECT lives_ok(
    $$
    SELECT public.persist_team_schedule(
        jsonb_build_object(
            'id', 'aaaaaaaa-0000-4000-8000-000000000e01',
            'organization_id', 'a1111111-1111-1111-1111-111111111111',
            'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
            'run_type', 'team',
            'status', 'completed',
            'parameters', jsonb_build_object('selectedProgramId', 'U10'),
            'results', jsonb_build_object('teams', jsonb_build_array(
                jsonb_build_object('id', 'bbbbbbbb-0000-4000-8000-0000000000b1', 'division', 'U10')
            ))
        ),
        jsonb_build_array(jsonb_build_object(
            'id', 'bbbbbbbb-0000-4000-8000-0000000000b1',
            'division_id', 'a1111111-1111-1111-1111-11111111abcd',
            'name', 'Team Alpha'
        )),
        '[]'::jsonb
    )
    $$,
    'persist accepts a team omitting assistant_coach_ids'
);

-- 4. The absent key preserved the previously-stored assistant list (COALESCE).
SELECT is(
    (SELECT assistant_coach_ids FROM public.teams WHERE id = 'bbbbbbbb-0000-4000-8000-0000000000b1'),
    ARRAY['cccccccc-0000-4000-8000-00000000aa02']::uuid[],
    'omitting assistant_coach_ids preserves the stored value (old-client safety)'
);

-- Persist a newer run with EMPTY results (a failed attempt) — it must not appear
-- in the latest-per-division output.
SELECT public.persist_team_schedule(
    jsonb_build_object(
        'id', 'aaaaaaaa-0000-4000-8000-000000000e02',
        'organization_id', 'a1111111-1111-1111-1111-111111111111',
        'season_settings_id', 'a1111111-1111-1111-1111-111111111aaa',
        'run_type', 'team',
        'status', 'failed',
        'results', '{}'::jsonb
    ),
    '[]'::jsonb,
    '[]'::jsonb
);

-- 5. get_latest returns exactly one division row for the org (the empty run is skipped).
SELECT is(
    (SELECT count(*) FROM public.get_latest_team_runs_per_division(
        'a1111111-1111-1111-1111-111111111111', NULL)),
    1::bigint,
    'get_latest skips the empty-results run and returns one division'
);

-- 6. That row resolves the division and points at the snapshot-bearing run.
SELECT is(
    (SELECT division || '|' || id::text
       FROM public.get_latest_team_runs_per_division(
            'a1111111-1111-1111-1111-111111111111', NULL)
      LIMIT 1),
    'U10|aaaaaaaa-0000-4000-8000-000000000e01',
    'get_latest resolves the division and returns the completed run'
);

SELECT * FROM finish();

ROLLBACK;
