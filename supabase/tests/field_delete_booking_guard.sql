-- pgTAP: admin_delete_field refuses booked ground, and practice_assignments
-- cannot be left dangling.
--
-- LIVE-1, pinned where CI can see it. `docs/sql/20260907000000_smoke.sql`
-- exercises the same guard in the local migration harness, which runs as
-- cluster superuser; this runs it through an authenticated session in
-- `pgtap.yml`, so the SECURITY DEFINER path and the org gate are exercised
-- rather than bypassed.

BEGIN;

\set squadlogic_fixture_include 1
\ir _fixtures.sql

SELECT plan(14);

-- ──────────────────────────────────────────────────────────────
-- Seed, as superuser, before any SET LOCAL role: one field with one booking
-- of EACH of the four kinds that carry a field_id, so an arm dropped from the
-- RPC's union changes the count rather than being absorbed by the others.
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.locations (id, organization_id, name)
VALUES ('c0000000-0000-0000-0000-0000000000c1',
        'a1111111-1111-1111-1111-111111111111', 'Guard Park')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.fields (id, organization_id, location_id, name, active)
VALUES ('c0000000-0000-0000-0000-0000000000c2',
        'a1111111-1111-1111-1111-111111111111',
        'c0000000-0000-0000-0000-0000000000c1', 'Guard Pitch', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.game_slots (id, organization_id, field_id, slot_date, week_index)
VALUES ('c0000000-0000-0000-0000-0000000000c3',
        'a1111111-1111-1111-1111-111111111111',
        'c0000000-0000-0000-0000-0000000000c2', current_date + 7, 1);

INSERT INTO public.game_assignments (id, organization_id, field_id, "start", week_index)
VALUES ('c0000000-0000-0000-0000-0000000000c4',
        'a1111111-1111-1111-1111-111111111111',
        'c0000000-0000-0000-0000-0000000000c2',
        timezone('utc', now()) + interval '7 days', 1);

INSERT INTO public.practice_slots (
    id, organization_id, field_id, day_of_week, start_time, end_time, valid_until
)
VALUES ('c0000000-0000-0000-0000-0000000000c5',
        'a1111111-1111-1111-1111-111111111111',
        'c0000000-0000-0000-0000-0000000000c2', 'mon', '18:00', '19:30', current_date + 60);

INSERT INTO public.practice_assignments (
    id, organization_id, team_id, field_id, effective_date_range
)
VALUES ('c0000000-0000-0000-0000-0000000000c6',
        'a1111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000001',
        'c0000000-0000-0000-0000-0000000000c2',
        daterange(current_date, current_date + 60, '[]'));

-- The unguarded two-argument overload must not exist. Argument TYPES, not
-- pg_get_function_identity_arguments, which carries parameter names and would
-- match nothing whatever the database held.
SELECT is(
    (
        SELECT count(*)::integer
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.proname = 'admin_delete_field'
           AND array_to_string(p.proargtypes::oid[]::regtype[], ', ') = 'uuid, uuid'
    ),
    0,
    'the unguarded admin_delete_field(uuid, uuid) is gone; nothing can route round the guard'
);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

-- ──────────────────────────────────────────────────────────────
-- 1. Unconfirmed delete of booked ground is refused, and says why.
-- ──────────────────────────────────────────────────────────────
SELECT is(
    (
        public.admin_delete_field(
            'a1111111-1111-1111-1111-111111111111',
            'c0000000-0000-0000-0000-0000000000c2'
        )->>'deleted'
    ),
    'false',
    'an unconfirmed delete of booked ground is refused'
);

SELECT is(
    (
        public.admin_delete_field(
            'a1111111-1111-1111-1111-111111111111',
            'c0000000-0000-0000-0000-0000000000c2'
        )->>'reason'
    ),
    'bookings_exist',
    'the refusal names its reason rather than only failing'
);

SELECT is(
    (
        public.admin_delete_field(
            'a1111111-1111-1111-1111-111111111111',
            'c0000000-0000-0000-0000-0000000000c2'
        )->>'affected_count'
    ),
    '4',
    'the refusal counts one booking from each of the four tables that hold a field_id'
);

SELECT is(
    (
        SELECT array_agg(DISTINCT x->>'kind' ORDER BY x->>'kind')
          FROM jsonb_array_elements(
                 public.admin_delete_field(
                     'a1111111-1111-1111-1111-111111111111',
                     'c0000000-0000-0000-0000-0000000000c2'
                 )->'affected'
               ) x
    ),
    ARRAY['game_assignment','game_slot','practice_assignment','practice_slot'],
    'the refusal names all four booking kinds, not only the slot tables'
);

SELECT is(
    (
        SELECT array_agg(DISTINCT x->>'disposition' ORDER BY x->>'disposition')
          FROM jsonb_array_elements(
                 public.admin_delete_field(
                     'a1111111-1111-1111-1111-111111111111',
                     'c0000000-0000-0000-0000-0000000000c2'
                 )->'affected'
               ) x
    ),
    ARRAY['deleted','unassigned'],
    'the refusal says what would happen to each booking, both outcomes present'
);

-- ──────────────────────────────────────────────────────────────
-- 2. A refusal writes nothing. Counted from the BOOKING tables and from
--    `fields` by id -- never derived from the field row a break would remove.
-- ──────────────────────────────────────────────────────────────
RESET ROLE;

SELECT is(
    (
        SELECT count(*)::integer FROM public.fields
         WHERE id = 'c0000000-0000-0000-0000-0000000000c2'
    ),
    1,
    'a refused delete leaves the field in place'
);

SELECT is(
    (
        (SELECT count(*) FROM public.game_slots WHERE id = 'c0000000-0000-0000-0000-0000000000c3')
      + (SELECT count(*) FROM public.game_assignments WHERE id = 'c0000000-0000-0000-0000-0000000000c4')
      + (SELECT count(*) FROM public.practice_slots WHERE id = 'c0000000-0000-0000-0000-0000000000c5')
      + (SELECT count(*) FROM public.practice_assignments WHERE id = 'c0000000-0000-0000-0000-0000000000c6')
    )::integer,
    4,
    'a refused delete destroys none of the four bookings'
);

SELECT isnt(
    (
        SELECT count(*)::integer FROM public.audit_log
         WHERE resource_id = 'c0000000-0000-0000-0000-0000000000c2'
           AND metadata->>'operation' = 'admin_delete_field'
           AND metadata->>'phase' = 'refused'
    ),
    0,
    'the refusal is recorded in the audit log'
);

-- ──────────────────────────────────────────────────────────────
-- 3. A confirmed delete proceeds, and each booking meets the disposition the
--    refusal declared for it.
-- ──────────────────────────────────────────────────────────────
SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"11111111-1111-1111-1111-111111111111"}';

SELECT is(
    (
        public.admin_delete_field(
            'a1111111-1111-1111-1111-111111111111',
            'c0000000-0000-0000-0000-0000000000c2',
            true
        )->>'deleted'
    ),
    'true',
    'a confirmed delete proceeds -- the guard is a confirmation, not a prohibition'
);

RESET ROLE;

SELECT is(
    (
        (SELECT count(*) FROM public.game_slots WHERE id = 'c0000000-0000-0000-0000-0000000000c3')
      + (SELECT count(*) FROM public.practice_slots WHERE id = 'c0000000-0000-0000-0000-0000000000c5')
    )::integer,
    0,
    'the slot tables cascade with the field, as their foreign keys declare'
);

SELECT is(
    (
        SELECT field_id FROM public.game_assignments
         WHERE id = 'c0000000-0000-0000-0000-0000000000c4'
    ),
    NULL::uuid,
    'the game assignment survives with its venue visibly gone, not destroyed'
);

-- **The defect this migration exists for.** Before the foreign key this column
-- kept the deleted field''s uuid, and nothing downstream could tell it from a
-- live venue.
SELECT is(
    (
        SELECT field_id FROM public.practice_assignments
         WHERE id = 'c0000000-0000-0000-0000-0000000000c6'
    ),
    NULL::uuid,
    'the practice assignment is unassigned rather than left dangling at a deleted field'
);

-- ──────────────────────────────────────────────────────────────
-- 4. The org gate still stands in front of all of it.
-- ──────────────────────────────────────────────────────────────
INSERT INTO public.fields (id, organization_id, location_id, name, active)
VALUES ('c0000000-0000-0000-0000-0000000000c7',
        'a1111111-1111-1111-1111-111111111111',
        'c0000000-0000-0000-0000-0000000000c1', 'Other Org Cannot Touch', true);

SET LOCAL role = 'authenticated';
SET LOCAL "request.jwt.claims" TO '{"sub":"22222222-2222-2222-2222-222222222222"}';

SELECT throws_ok(
    $$
        SELECT public.admin_delete_field(
            'a1111111-1111-1111-1111-111111111111',
            'c0000000-0000-0000-0000-0000000000c7',
            true
        )
    $$,
    '42501',
    NULL,
    'an admin of another organization cannot delete this org''s ground, confirmed or not'
);

SELECT * FROM finish();
ROLLBACK;
