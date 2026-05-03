-- pgTAP: admin coach operational mutations are org-scoped and auditable.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(22);

INSERT INTO public.coaches (
    id,
    organization_id,
    full_name,
    email,
    status,
    can_coach_multiple_teams
)
VALUES
    (
        'a1111111-1111-1111-1111-00000000c101',
        'a1111111-1111-1111-1111-111111111111',
        'Org A Active One',
        'org-a-active-one@example.com',
        'active',
        false
    ),
    (
        'a1111111-1111-1111-1111-00000000c102',
        'a1111111-1111-1111-1111-111111111111',
        'Org A Active Two',
        'org-a-active-two@example.com',
        'active',
        false
    ),
    (
        'a1111111-1111-1111-1111-00000000c103',
        'a1111111-1111-1111-1111-111111111111',
        'Org A Multi Coach',
        'org-a-multi@example.com',
        'active',
        true
    ),
    (
        'a1111111-1111-1111-1111-00000000c104',
        'a1111111-1111-1111-1111-111111111111',
        'Org A Interested Lead',
        'org-a-interested@example.com',
        'interested',
        false
    ),
    (
        'a1111111-1111-1111-1111-00000000c106',
        'a1111111-1111-1111-1111-111111111111',
        'Org A Null Status Coach',
        'org-a-null-status@example.com',
        NULL,
        false
    ),
    (
        'b2222222-2222-2222-2222-00000000c201',
        'b2222222-2222-2222-2222-222222222222',
        'Org B Active Coach',
        'org-b-active@example.com',
        'active',
        false
    );

INSERT INTO public.teams (id, organization_id, division_id, name)
VALUES (
    'aaaaaaaa-0000-0000-0000-000000000011',
    'a1111111-1111-1111-1111-111111111111',
    'a1111111-1111-1111-1111-11111111abcd',
    'A-Team Two'
)
ON CONFLICT (id) DO NOTHING;

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (public.admin_update_coach_status(
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-00000000c104',
        'active'
    )->>'status'),
    'active',
    'Org A admin can promote an interested coach lead to active'
);

SELECT is(
    (
        SELECT status
        FROM public.coaches
        WHERE id = 'a1111111-1111-1111-1111-00000000c104'
    ),
    'active',
    'coach status is persisted after promotion'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.audit_log
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND action = 'coach.promoted'
          AND resource_id = 'a1111111-1111-1111-1111-00000000c104'
    )::int,
    1,
    'coach promotion writes an audit row'
);

SELECT is(
    (public.admin_assign_team_coach(
        'a1111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'a1111111-1111-1111-1111-00000000c101'
    )->>'coach_id'),
    'a1111111-1111-1111-1111-00000000c101',
    'Org A admin can assign an active coach to an Org A team'
);

SELECT is(
    (
        SELECT coach_id::text
        FROM public.teams
        WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001'
    ),
    'a1111111-1111-1111-1111-00000000c101',
    'team coach assignment is persisted'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.audit_log
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND action = 'team.coach_assigned'
          AND resource_id = 'aaaaaaaa-0000-0000-0000-000000000001'
    )::int,
    1,
    'initial coach assignment writes an audit row'
);

SELECT is(
    (public.admin_assign_team_coach(
        'a1111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'a1111111-1111-1111-1111-00000000c102'
    )->>'previous_coach_id'),
    'a1111111-1111-1111-1111-00000000c101',
    'assigning a new coach to a coached team returns the previous coach'
);

SELECT is(
    (
        SELECT metadata->>'previous_coach_id'
        FROM public.audit_log
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND action = 'team.coach_swapped'
          AND resource_id = 'aaaaaaaa-0000-0000-0000-000000000001'
        ORDER BY created_at DESC
        LIMIT 1
    ),
    'a1111111-1111-1111-1111-00000000c101',
    'coach swap audit metadata records the replaced coach'
);

SELECT throws_ok(
    $$
        SELECT public.admin_assign_team_coach(
            'a1111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000011',
            'a1111111-1111-1111-1111-00000000c102'
        )
    $$,
    '23514',
    NULL,
    'single-team coach cannot be assigned to a second team'
);

SELECT is(
    (public.admin_assign_team_coach(
        'a1111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'a1111111-1111-1111-1111-00000000c103'
    )->>'coach_id'),
    'a1111111-1111-1111-1111-00000000c103',
    'multi-team coach can replace another coach'
);

SELECT is(
    (public.admin_assign_team_coach(
        'a1111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000011',
        'a1111111-1111-1111-1111-00000000c103'
    )->>'coach_id'),
    'a1111111-1111-1111-1111-00000000c103',
    'multi-team coach can be assigned to a second team'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.teams
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND coach_id = 'a1111111-1111-1111-1111-00000000c103'
    )::int,
    2,
    'multi-team coach has two persisted team assignments'
);

SELECT is(
    (public.admin_assign_team_coach(
        'a1111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000011',
        NULL
    )->>'coach_id'),
    NULL::text,
    'admin can clear a team coach assignment'
);

SELECT is(
    (
        SELECT coach_id::text
        FROM public.teams
        WHERE id = 'aaaaaaaa-0000-0000-0000-000000000011'
    ),
    NULL::text,
    'cleared team coach assignment is persisted'
);

SELECT throws_ok(
    $$
        SELECT public.admin_update_coach_status(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-00000000c103',
            'inactive'
        )
    $$,
    '23514',
    NULL,
    'assigned coach cannot be marked inactive'
);

SELECT is(
    (public.admin_update_coach_status(
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-00000000c102',
        'inactive'
    )->>'status'),
    'inactive',
    'unassigned coach can be marked inactive'
);

SELECT is(
    (public.admin_update_coach_status(
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-00000000c106',
        'active'
    )->>'status'),
    'active',
    'admin_update_coach_status can repair an in-org coach with NULL status'
);

SELECT throws_ok(
    $$
        SELECT public.admin_update_coach_status(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-00000000c102',
            'archived'
        )
    $$,
    '23514',
    NULL,
    'invalid coach status is rejected'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333"}';

SELECT throws_ok(
    $$
        SELECT public.admin_update_coach_status(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-00000000c102',
            'active'
        )
    $$,
    '42501',
    NULL,
    'Org A coach member cannot update coach statuses'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222"}';

SELECT throws_ok(
    $$
        SELECT public.admin_update_coach_status(
            'a1111111-1111-1111-1111-111111111111',
            'a1111111-1111-1111-1111-00000000c102',
            'active'
        )
    $$,
    '42501',
    NULL,
    'Org B admin cannot update Org A coach statuses'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT throws_ok(
    $$
        SELECT public.admin_assign_team_coach(
            'a1111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000011',
            'b2222222-2222-2222-2222-00000000c201'
        )
    $$,
    '42501',
    NULL,
    'Org A admin cannot assign an Org B coach to an Org A team'
);

SELECT throws_ok(
    $$
        SELECT public.admin_assign_team_coach(
            'a1111111-1111-1111-1111-111111111111',
            'bbbbbbbb-0000-0000-0000-000000000002',
            'a1111111-1111-1111-1111-00000000c101'
        )
    $$,
    '42501',
    NULL,
    'Org A admin cannot assign an Org A coach to an Org B team'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
