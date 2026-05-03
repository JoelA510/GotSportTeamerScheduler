-- pgTAP: player-import coach leads stay idempotent and org-scoped.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(16);

INSERT INTO public.players (
    id,
    organization_id,
    division_id,
    first_name,
    last_name,
    external_registration_id
)
VALUES
    (
        'a1111111-1111-1111-1111-000000000101',
        'a1111111-1111-1111-1111-111111111111',
        'a1111111-1111-1111-1111-11111111abcd',
        'Riley',
        'Reyes',
        'GS-A-101'
    ),
    (
        'b2222222-2222-2222-2222-000000000202',
        'b2222222-2222-2222-2222-222222222222',
        'b2222222-2222-2222-2222-22222222bcde',
        'Jordan',
        'Brooks',
        'GS-B-202'
    );

INSERT INTO public.coaches (id, organization_id, full_name, email, status)
VALUES (
    'aaaaaaaa-aaaa-aaaa-aaaa-000000000101',
    'a1111111-1111-1111-1111-111111111111',
    'Existing Active Coach',
    'active.coachlead@example.com',
    'active'
);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (public.upsert_coach_leads(jsonb_build_array(jsonb_build_object(
        'email', 'Morgan.Reyes@example.com',
        'full_name', 'Morgan Reyes',
        'organization_id', 'a1111111-1111-1111-1111-111111111111',
        'division_id', 'a1111111-1111-1111-1111-11111111abcd',
        'player_id', 'a1111111-1111-1111-1111-000000000101'
    )))->>'leads_created')::int,
    1,
    'upsert_coach_leads creates an interested coach lead'
);

SELECT is(
    (SELECT status FROM public.coaches WHERE email = 'morgan.reyes@example.com'),
    'interested',
    'new player-import coach lead is marked interested'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.coach_interested_programs cip
        JOIN public.coaches c ON c.id = cip.coach_id
        WHERE c.email = 'morgan.reyes@example.com'
          AND cip.organization_id = 'a1111111-1111-1111-1111-111111111111'
          AND cip.division_id = 'a1111111-1111-1111-1111-11111111abcd'
          AND cip.inferred_from_player_id = 'a1111111-1111-1111-1111-000000000101'
    )::int,
    1,
    'coach lead links the interested coach to the org-scoped division and player'
);

SELECT is(
    (public.upsert_coach_leads(jsonb_build_array(jsonb_build_object(
        'email', 'morgan.reyes@example.com',
        'full_name', 'Morgan Reyes',
        'organization_id', 'a1111111-1111-1111-1111-111111111111',
        'division_id', 'a1111111-1111-1111-1111-11111111abcd',
        'player_id', 'a1111111-1111-1111-1111-000000000101'
    )))->>'programs_linked')::int,
    0,
    're-running the same lead is idempotent for program links'
);

SELECT is(
    (public.upsert_coach_leads(jsonb_build_array(jsonb_build_object(
        'email', 'active.coachlead@example.com',
        'full_name', 'Existing Active Coach',
        'organization_id', 'a1111111-1111-1111-1111-111111111111',
        'division_id', 'a1111111-1111-1111-1111-11111111abcd',
        'player_id', 'a1111111-1111-1111-1111-000000000101'
    )))->>'leads_created')::int,
    0,
    'existing org coach is reused rather than recreated'
);

SELECT is(
    (SELECT status FROM public.coaches WHERE email = 'active.coachlead@example.com'),
    'active',
    'existing active coach is not downgraded to interested'
);

SELECT ok(
    (SELECT last_imported_at IS NOT NULL FROM public.coaches WHERE email = 'active.coachlead@example.com'),
    'existing active coach last_imported_at is refreshed on re-import'
);

SELECT is(
    (
        SELECT count(*)
        FROM public.coach_interested_programs
        WHERE coach_id = 'aaaaaaaa-aaaa-aaaa-aaaa-000000000101'
          AND division_id = 'a1111111-1111-1111-1111-11111111abcd'
    )::int,
    1,
    'existing active coach can still receive an interested-program link'
);

SELECT throws_ok(
    $$
        SELECT public.upsert_coach_leads(jsonb_build_array(jsonb_build_object(
            'email', 'bad.division@example.com',
            'full_name', 'Bad Division',
            'organization_id', 'a1111111-1111-1111-1111-111111111111',
            'division_id', 'b2222222-2222-2222-2222-22222222bcde',
            'player_id', 'a1111111-1111-1111-1111-000000000101'
        )))
    $$,
    '42501',
    NULL,
    'RPC rejects a lead whose division belongs to another organization'
);

SELECT throws_ok(
    $$
        SELECT public.upsert_coach_leads(jsonb_build_array(jsonb_build_object(
            'email', 'bad.player@example.com',
            'full_name', 'Bad Player',
            'organization_id', 'a1111111-1111-1111-1111-111111111111',
            'division_id', 'a1111111-1111-1111-1111-11111111abcd',
            'player_id', 'b2222222-2222-2222-2222-000000000202'
        )))
    $$,
    '42501',
    NULL,
    'RPC rejects a lead whose player belongs to another organization'
);

SELECT lives_ok(
    $$
        SELECT public.set_import_job_coach_lead_summary(
            'aaaabbbb-1111-1111-1111-111111111111',
            '{"status":"completed","leads_submitted":1}'::jsonb,
            'completed_with_warnings'
        )
    $$,
    'org member can atomically persist a coach lead import summary'
);

SELECT is(
    (
        SELECT warning_summary #>> '{coach_leads,status}'
        FROM public.import_jobs
        WHERE id = 'aaaabbbb-1111-1111-1111-111111111111'
    ),
    'completed',
    'coach lead summary is merged under warning_summary.coach_leads'
);

SELECT is(
    (
        SELECT status
        FROM public.import_jobs
        WHERE id = 'aaaabbbb-1111-1111-1111-111111111111'
    ),
    'completed_with_warnings',
    'coach lead summary RPC can atomically set the import job status'
);

SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222"}';

SELECT throws_ok(
    $$
        SELECT public.set_import_job_coach_lead_summary(
            'aaaabbbb-1111-1111-1111-111111111111',
            '{"status":"blocked"}'::jsonb,
            'completed'
        )
    $$,
    '42501',
    NULL,
    'Org B admin cannot update Org A import coach lead summaries'
);

SELECT throws_ok(
    $$
        SELECT public.upsert_coach_leads(jsonb_build_array(jsonb_build_object(
            'email', 'wrong.member@example.com',
            'full_name', 'Wrong Member',
            'organization_id', 'a1111111-1111-1111-1111-111111111111',
            'division_id', 'a1111111-1111-1111-1111-11111111abcd',
            'player_id', 'a1111111-1111-1111-1111-000000000101'
        )))
    $$,
    '42501',
    NULL,
    'Org B admin cannot create Org A coach leads'
);

RESET ROLE;

SELECT throws_ok(
    $$
        INSERT INTO public.coach_interested_programs (
            coach_id,
            division_id,
            inferred_from_player_id,
            organization_id
        )
        VALUES (
            (SELECT id FROM public.coaches WHERE email = 'morgan.reyes@example.com'),
            'b2222222-2222-2222-2222-22222222bcde',
            'a1111111-1111-1111-1111-000000000101',
            'a1111111-1111-1111-1111-111111111111'
        )
    $$,
    '23514',
    NULL,
    'trigger rejects direct cross-org coach interest links'
);

SELECT * FROM finish();
ROLLBACK;
