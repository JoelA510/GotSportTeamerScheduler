-- pgTAP: team portal RSVP/message writes are RPC-routed and scoped.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(21);

INSERT INTO auth.users (id, email, raw_user_meta_data, aud, role)
VALUES (
    '44444444-4444-4444-4444-444444444444',
    'pat-parent@test.local',
    jsonb_build_object('full_name', 'Pat Parent', 'password_length', 12),
    'authenticated',
    'authenticated'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.profiles (id, email, full_name)
VALUES ('44444444-4444-4444-4444-444444444444', 'pat-parent@test.local', 'Pat Parent')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.organization_members (organization_id, profile_id, role)
VALUES (
    'a1111111-1111-1111-1111-111111111111',
    '44444444-4444-4444-4444-444444444444',
    'parent'
)
ON CONFLICT (organization_id, profile_id) DO NOTHING;

INSERT INTO public.coaches (
    id,
    organization_id,
    profile_id,
    user_id,
    full_name,
    email,
    status
)
VALUES (
    'a1111111-1111-1111-1111-00000000cc01',
    'a1111111-1111-1111-1111-111111111111',
    '33333333-3333-3333-3333-333333333333',
    '33333333-3333-3333-3333-333333333333',
    'Charlie Coach-A',
    'charlie-team-portal@example.com',
    'active'
)
ON CONFLICT (email) DO UPDATE SET
    profile_id = EXCLUDED.profile_id,
    user_id = EXCLUDED.user_id,
    status = EXCLUDED.status;

INSERT INTO public.teams (id, organization_id, division_id, name)
VALUES (
    'aaaaaaaa-0000-0000-0000-000000000003',
    'a1111111-1111-1111-1111-111111111111',
    'a1111111-1111-1111-1111-11111111abcd',
    'A-Team 2'
)
ON CONFLICT (id) DO NOTHING;

UPDATE public.teams
   SET coach_id = 'a1111111-1111-1111-1111-00000000cc01'
 WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

INSERT INTO public.players (id, organization_id, division_id, first_name, last_name)
VALUES
    (
        'a1111111-1111-1111-1111-00000000a201',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-11111111abcd',
        'Ava',
        'Roster'
    ),
    (
        'a1111111-1111-1111-1111-00000000a202',
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
        'a1111111-1111-1111-1111-00000000a201',
        'a1111111-1111-1111-1111-111111111111'
    ),
    (
        'aaaaaaaa-0000-0000-0000-000000000001',
        'a1111111-1111-1111-1111-00000000a202',
        'a1111111-1111-1111-1111-111111111111'
    )
ON CONFLICT (team_id, player_id) DO NOTHING;

INSERT INTO public.profile_players (profile_id, player_id, organization_id)
VALUES (
    '44444444-4444-4444-4444-444444444444',
    'a1111111-1111-1111-1111-00000000a201',
    'a1111111-1111-1111-1111-111111111111'
)
ON CONFLICT (profile_id, player_id) DO NOTHING;

INSERT INTO public.games (
    id,
    organization_id,
    season_id,
    home_team_id,
    away_team_id,
    start_time
)
VALUES (
    'a1111111-1111-1111-1111-00000000aa21',
    'a1111111-1111-1111-1111-111111111111',
    'a1111111-1111-1111-1111-111111111aaa',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'aaaaaaaa-0000-0000-0000-000000000003',
    '2026-05-10T09:00:00Z'::timestamptz
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.locations (id, organization_id, name)
VALUES (
    'a1111111-1111-1111-1111-00000000dd21',
    'a1111111-1111-1111-1111-111111111111',
    'Practice Complex'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.fields (id, organization_id, location_id, name, active)
VALUES (
    'a1111111-1111-1111-1111-00000000dd22',
    'a1111111-1111-1111-1111-111111111111',
    'a1111111-1111-1111-1111-00000000dd21',
    'Practice Field',
    true
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.practice_slots (
    id,
    organization_id,
    field_id,
    day_of_week,
    start_time,
    end_time,
    capacity,
    valid_from,
    valid_until
)
VALUES (
    'a1111111-1111-1111-1111-00000000dd23',
    'a1111111-1111-1111-1111-111111111111',
    'a1111111-1111-1111-1111-00000000dd22',
    'tue',
    '17:00'::time,
    '18:30'::time,
    2,
    '2026-05-01'::date,
    '2026-06-01'::date
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.practice_assignments (
    id,
    organization_id,
    team_id,
    slot_id,
    practice_slot_id,
    day_of_week,
    effective_date_range
)
VALUES (
    'a1111111-1111-1111-1111-00000000dd24',
    'a1111111-1111-1111-1111-111111111111',
    'aaaaaaaa-0000-0000-0000-000000000001',
    'a1111111-1111-1111-1111-00000000dd23',
    'a1111111-1111-1111-1111-00000000dd23',
    'tue',
    '[2026-05-01,2026-06-01)'::daterange
)
ON CONFLICT (id) DO NOTHING;

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"44444444-4444-4444-4444-444444444444","app_metadata":{"role":"parent"}}';

SELECT lives_ok(
    $$
        SELECT public.upsert_team_event_rsvp(
            'aaaaaaaa-0000-0000-0000-000000000001',
            'a1111111-1111-1111-1111-00000000a201',
            'a1111111-1111-1111-1111-00000000aa21',
            'game',
            '2026-05-10'::date,
            'attending'
        )
    $$,
    'linked parent can RSVP a rostered player for a team game'
);

SELECT is(
    (
        SELECT status
        FROM public.event_rsvps
        WHERE player_id = 'a1111111-1111-1111-1111-00000000a201'
          AND reference_id = 'a1111111-1111-1111-1111-00000000aa21'
    ),
    'attending',
    'RSVP status is persisted'
);

SELECT is(
    (
        SELECT (public.upsert_team_event_rsvp(
            'aaaaaaaa-0000-0000-0000-000000000001',
            'a1111111-1111-1111-1111-00000000a201',
            'a1111111-1111-1111-1111-00000000aa21',
            'game',
            '2026-05-10'::date,
            'declined'
        )->>'changed')::boolean
    ),
    true,
    'changing an RSVP reports changed=true'
);

RESET ROLE;

SELECT is(
    (
        SELECT count(*)
        FROM public.audit_log
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND action = 'team.rsvp_updated'
    )::int,
    2,
    'RSVP insert and status change write audit rows'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.audit_log
        WHERE action = 'team.rsvp_updated'
          AND metadata->>'status' = 'declined'
    )::int,
    1,
    'RSVP audit metadata records the resulting status'
);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"44444444-4444-4444-4444-444444444444","app_metadata":{"role":"parent"}}';

SELECT is(
    (
        SELECT (public.upsert_team_event_rsvp(
            'aaaaaaaa-0000-0000-0000-000000000001',
            'a1111111-1111-1111-1111-00000000a201',
            'a1111111-1111-1111-1111-00000000aa21',
            'game',
            '2026-05-10'::date,
            'declined'
        )->>'changed')::boolean
    ),
    false,
    'repeating the same RSVP status is idempotent'
);

RESET ROLE;

SELECT is(
    (
        SELECT count(*)
        FROM public.audit_log
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND action = 'team.rsvp_updated'
    )::int,
    2,
    'idempotent RSVP repeat does not add audit rows'
);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"44444444-4444-4444-4444-444444444444","app_metadata":{"role":"parent"}}';

SELECT throws_ok(
    $$
        INSERT INTO public.event_rsvps (
            organization_id,
            team_id,
            player_id,
            reference_id,
            event_type,
            occurrence_date,
            status
        )
        VALUES (
            'a1111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000001',
            'a1111111-1111-1111-1111-00000000a201',
            'a1111111-1111-1111-1111-00000000aa21',
            'game',
            '2026-05-11'::date,
            'maybe'
        )
    $$,
    '42501',
    NULL,
    'direct event_rsvps inserts are blocked'
);

SELECT throws_ok(
    $$
        SELECT public.upsert_team_event_rsvp(
            'aaaaaaaa-0000-0000-0000-000000000001',
            'a1111111-1111-1111-1111-00000000a202',
            'a1111111-1111-1111-1111-00000000aa21',
            'game',
            '2026-05-10'::date,
            'maybe'
        )
    $$,
    '42501',
    NULL,
    'parent cannot RSVP a rostered player without profile_players ownership'
);

SELECT throws_ok(
    $$
        SELECT public.upsert_team_event_rsvp(
            'aaaaaaaa-0000-0000-0000-000000000001',
            'a1111111-1111-1111-1111-00000000a201',
            'a1111111-1111-1111-1111-00000000aa21',
            'meeting',
            '2026-05-10'::date,
            'maybe'
        )
    $$,
    '22023',
    NULL,
    'invalid event type is rejected'
);

SELECT throws_ok(
    $$
        SELECT public.upsert_team_event_rsvp(
            'aaaaaaaa-0000-0000-0000-000000000001',
            'a1111111-1111-1111-1111-00000000a201',
            'a1111111-1111-1111-1111-00000000aa21',
            'game',
            '2026-05-11'::date,
            'maybe'
        )
    $$,
    '42501',
    NULL,
    'game RSVP date must match the game date'
);

SELECT lives_ok(
    $$
        SELECT public.upsert_team_event_rsvp(
            'aaaaaaaa-0000-0000-0000-000000000001',
            'a1111111-1111-1111-1111-00000000a201',
            'a1111111-1111-1111-1111-00000000dd24',
            'practice',
            '2026-05-12'::date,
            'maybe'
        )
    $$,
    'linked parent can RSVP for a practice occurrence on the configured weekday'
);

SELECT throws_ok(
    $$
        SELECT public.upsert_team_event_rsvp(
            'aaaaaaaa-0000-0000-0000-000000000001',
            'a1111111-1111-1111-1111-00000000a201',
            'a1111111-1111-1111-1111-00000000dd24',
            'practice',
            '2026-05-13'::date,
            'maybe'
        )
    $$,
    '42501',
    NULL,
    'practice RSVP date must match the assignment weekday'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333","app_metadata":{"role":"coach"}}';

SELECT lives_ok(
    $$
        SELECT public.create_team_message(
            'aaaaaaaa-0000-0000-0000-000000000001',
            '  Bring orange jerseys.  '
        )
    $$,
    'assigned coach can create a team message'
);

SELECT is(
    (
        SELECT content
        FROM public.team_messages
        WHERE team_id = 'aaaaaaaa-0000-0000-0000-000000000001'
        ORDER BY created_at DESC
        LIMIT 1
    ),
    'Bring orange jerseys.',
    'message content is trimmed before storage'
);

RESET ROLE;

SELECT is(
    (
        SELECT count(*)
        FROM public.audit_log
        WHERE organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND action = 'team.message_created'
    )::int,
    1,
    'message create writes one audit row'
);

SELECT is(
    (
        SELECT metadata ? 'content'
        FROM public.audit_log
        WHERE action = 'team.message_created'
        ORDER BY created_at DESC
        LIMIT 1
    ),
    false,
    'message audit metadata omits message content'
);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"33333333-3333-3333-3333-333333333333","app_metadata":{"role":"coach"}}';

SELECT throws_ok(
    $$
        SELECT public.create_team_message(
            'aaaaaaaa-0000-0000-0000-000000000001',
            '   '
        )
    $$,
    '22023',
    NULL,
    'blank message content is rejected'
);

SELECT throws_ok(
    $$
        INSERT INTO public.team_messages (organization_id, team_id, author_id, content)
        VALUES (
            'a1111111-1111-1111-1111-111111111111',
            'aaaaaaaa-0000-0000-0000-000000000001',
            '33333333-3333-3333-3333-333333333333',
            'Direct write should fail'
        )
    $$,
    '42501',
    NULL,
    'direct team_messages inserts are blocked'
);

RESET ROLE;
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222","app_metadata":{"role":"admin"}}';

SELECT throws_ok(
    $$
        SELECT public.create_team_message(
            'aaaaaaaa-0000-0000-0000-000000000001',
            'Cross-org post'
        )
    $$,
    '42501',
    NULL,
    'Org B admin cannot post to an Org A team'
);

SELECT throws_ok(
    $$
        SELECT public.upsert_team_event_rsvp(
            'aaaaaaaa-0000-0000-0000-000000000001',
            'a1111111-1111-1111-1111-00000000a201',
            'a1111111-1111-1111-1111-00000000aa21',
            'game',
            '2026-05-10'::date,
            'maybe'
        )
    $$,
    '42501',
    NULL,
    'Org B admin cannot RSVP against an Org A team'
);

SELECT * FROM finish();

ROLLBACK;
