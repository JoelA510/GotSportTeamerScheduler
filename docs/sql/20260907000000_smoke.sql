-- Smoke checks for 20260907000000_field_delete_booking_guard.sql
--
-- **These ASSERT rather than report.** A smoke made of bare SELECTs exits 0
-- whatever it prints. Every invariant below RAISEs, so
-- `scripts/dbharness/prove.sh` can plant the defect each one exists to catch
-- and require this file to go red -- and, for the plants aimed here, require
-- the smokes that run EARLIER to stay green, so the evidence is this file's
-- own rather than borrowed from one of them.
--
-- Figures that are evidence rather than gates are reporting SELECTs at the
-- foot and are labelled as such.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 1. The signature, and the absence of the one it replaces
-- ---------------------------------------------------------------------------
--
-- The two-argument function must be GONE. Leaving it beside the new one is not
-- a harmless duplicate: with both present, every two-argument call -- named or
-- positional -- raises `42725 function ... is not unique` (measured, not
-- assumed), so the delete path stops working entirely and the obvious repair
-- is to name the old signature explicitly, which is the unguarded body. A
-- guard a second signature routes around is not a guard.
DO $$
DECLARE v_two int; v_three int;
BEGIN
  -- **Argument TYPES, not `pg_get_function_identity_arguments`.** That
  -- function includes parameter names on this server, so comparing it against
  -- 'uuid, uuid' matched nothing whatever the database held -- a check that
  -- could not fail, written into the file whose whole purpose is checks that
  -- can. Caught by its twin below going red on a correct database.
  SELECT count(*) INTO v_two
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_delete_field'
     AND array_to_string(p.proargtypes::oid[]::regtype[], ', ') = 'uuid, uuid';
  IF v_two <> 0 THEN
    RAISE EXCEPTION 'the unguarded admin_delete_field(uuid, uuid) still exists; a caller can route round the guard';
  END IF;

  SELECT count(*) INTO v_three
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_delete_field'
     AND array_to_string(p.proargtypes::oid[]::regtype[], ', ') = 'uuid, uuid, boolean';
  IF v_three <> 1 THEN
    RAISE EXCEPTION 'expected exactly one admin_delete_field(uuid, uuid, boolean), found %', v_three;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Hardening, grants, and the refusal named in the body
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  SELECT p.prosecdef,
         COALESCE(array_to_string(p.proconfig, ','), '') AS cfg,
         pg_get_functiondef(p.oid) AS def
    INTO r
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_delete_field';

  IF NOT FOUND THEN RAISE EXCEPTION 'admin_delete_field missing'; END IF;
  IF NOT r.prosecdef THEN RAISE EXCEPTION 'admin_delete_field is not SECURITY DEFINER'; END IF;
  IF r.cfg NOT LIKE '%search_path=public%' THEN
    RAISE EXCEPTION 'admin_delete_field does not pin search_path'; END IF;
  IF r.def NOT LIKE '%is_org_admin%' THEN
    RAISE EXCEPTION 'admin_delete_field does not gate on is_org_admin'; END IF;
  IF r.def NOT LIKE '%42501%' THEN
    RAISE EXCEPTION 'admin_delete_field does not raise 42501'; END IF;

  -- The refusal lives in the RPC, not only in the UI, and it names its reason
  -- so a caller can branch on something other than a string.
  IF r.def NOT LIKE '%bookings_exist%' THEN
    RAISE EXCEPTION 'admin_delete_field does not name its refusal reason'; END IF;
  IF r.def NOT LIKE '%''phase'', ''refused''%' THEN
    RAISE EXCEPTION 'admin_delete_field does not audit the refusal'; END IF;
  IF r.def NOT LIKE '%''phase'', ''before''%' THEN
    RAISE EXCEPTION 'admin_delete_field does not audit before'; END IF;
  IF r.def NOT LIKE '%''phase'', ''after''%' THEN
    RAISE EXCEPTION 'admin_delete_field does not audit after'; END IF;

  IF has_function_privilege('public','public.admin_delete_field(uuid, uuid, boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC must not execute admin_delete_field'; END IF;
  IF NOT has_function_privilege('authenticated','public.admin_delete_field(uuid, uuid, boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute admin_delete_field'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 3. practice_assignments.field_id is constrained, and constrained SET NULL
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_del char; v_refs text;
BEGIN
  SELECT con.confdeltype, tgt.relname
    INTO v_del, v_refs
    FROM pg_constraint con
    JOIN pg_class src ON src.oid = con.conrelid
    JOIN pg_class tgt ON tgt.oid = con.confrelid
   WHERE con.contype = 'f'
     AND src.relname = 'practice_assignments'
     AND con.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                              WHERE a.attrelid = src.oid AND a.attname = 'field_id')]::smallint[];

  IF v_del IS NULL THEN
    RAISE EXCEPTION 'practice_assignments.field_id has no foreign key; the value can dangle again';
  END IF;
  IF v_refs <> 'fields' THEN
    RAISE EXCEPTION 'practice_assignments.field_id references %, not fields', v_refs; END IF;
  -- SET NULL, matching game_assignments.field_id. CASCADE would destroy the
  -- booking; RESTRICT would make a confirmed delete impossible.
  IF v_del <> 'n' THEN
    RAISE EXCEPTION 'practice_assignments.field_id is ON DELETE %, expected n (SET NULL)', v_del;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 4. THE CASCADE CLOSURE -- derived from the referential graph, on every run
-- ---------------------------------------------------------------------------
--
-- **The family is not "tables with a field_id".** That was this check's first
-- form and it was wrong in a way that mattered: `games` carries no field_id and
-- is destroyed anyway, because it hangs off `game_slots` ON DELETE CASCADE. A
-- census that cannot see the one table holding a recorded score is not a
-- census of what a delete costs.
--
-- So the closure is walked here -- every foreign key that reaches `fields`, and
-- then transitively through every CASCADE edge -- and compared against a
-- declared list. A table joining or leaving the closure fails this run, in
-- either direction, so the next `games` cannot arrive unnoticed.
DO $$
DECLARE
  v_actual text[];
  v_declared text[] := ARRAY[
    'field_availability_profiles','field_blackouts','field_subunits',
    'game_assignments','game_slots','games',
    'practice_assignments','practice_slots'
  ];
  -- Read by admin_delete_field. The other three are excluded for reasons the
  -- migration header states; section 4b holds it to both halves.
  v_bookings text[] := ARRAY[
    'game_assignments','game_slots','games','practice_assignments','practice_slots'
  ];
  v_excluded text[] := ARRAY['field_availability_profiles','field_blackouts','field_subunits'];
  v_def text;
  t text;
BEGIN
  WITH RECURSIVE fk AS (
    SELECT src.relname::text AS src, tgt.relname::text AS tgt, con.confdeltype AS del
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_class tgt ON tgt.oid = con.confrelid
      JOIN pg_namespace n ON n.oid = src.relnamespace AND n.nspname = 'public'
     WHERE con.contype = 'f'
  ), closure AS (
    SELECT fk.src, fk.del FROM fk WHERE fk.tgt = 'fields'
    UNION
    SELECT fk.src, fk.del FROM fk JOIN closure c ON fk.tgt = c.src AND c.del = 'c'
  )
  SELECT array_agg(DISTINCT src ORDER BY src) INTO v_actual FROM closure;

  -- Meta-assertion: a walk that found nothing would agree with nothing and
  -- pass every comparison below by being empty on both sides.
  IF v_actual IS NULL OR array_length(v_actual, 1) IS NULL THEN
    RAISE EXCEPTION 'the cascade closure from fields is empty; the walk is not reading pg_constraint';
  END IF;

  IF v_actual <> (SELECT array_agg(x ORDER BY x) FROM unnest(v_declared) x) THEN
    RAISE EXCEPTION
      'the cascade closure from fields changed: schema reaches %, this migration declares %. Decide whether the new member is a booking.',
      v_actual, (SELECT array_agg(x ORDER BY x) FROM unnest(v_declared) x);
  END IF;

  IF v_declared <> (SELECT array_agg(x ORDER BY x) FROM unnest(v_bookings || v_excluded) x) THEN
    RAISE EXCEPTION 'every closure member must be read or excluded; the two lists do not cover the declared set';
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_delete_field';

  FOREACH t IN ARRAY v_bookings LOOP
    IF v_def NOT LIKE '%public.' || t || '%' THEN
      RAISE EXCEPTION 'admin_delete_field does not enumerate %, which a field delete destroys rows in', t;
    END IF;
  END LOOP;

  FOREACH t IN ARRAY v_excluded LOOP
    IF v_def LIKE '%public.' || t || '%' THEN
      RAISE EXCEPTION
        'admin_delete_field reads %, which this migration documents as NOT a booking', t;
    END IF;
  END LOOP;

  RAISE NOTICE 'cascade closure from fields: % tables, % read as bookings, % excluded',
    array_length(v_actual, 1), array_length(v_bookings, 1), array_length(v_excluded, 1);
END $$;

-- 4b. The seven-table field_id family is still checked, because it is the set
-- the FOREIGN KEY work in section 3 is about. It is a SUBSET of the closure,
-- not the same thing, and conflating the two is what hid `games`.
DO $$
DECLARE v_actual text[];
BEGIN
  SELECT array_agg(c.table_name::text ORDER BY c.table_name)
    INTO v_actual
    FROM information_schema.columns c
    JOIN information_schema.tables t2
      ON t2.table_schema = c.table_schema AND t2.table_name = c.table_name
     AND t2.table_type = 'BASE TABLE'
   WHERE c.table_schema = 'public' AND c.column_name = 'field_id';

  IF v_actual IS NULL OR array_length(v_actual, 1) <> 7 THEN
    RAISE EXCEPTION 'expected 7 tables carrying a field_id, found %', v_actual;
  END IF;
  IF v_actual <> ARRAY['field_availability_profiles','field_blackouts','field_subunits',
                       'game_assignments','game_slots','practice_assignments','practice_slots'] THEN
    RAISE EXCEPTION 'the field_id family changed: %', v_actual;
  END IF;
  RAISE NOTICE 'field_id family: 7 tables, a subset of the 8-table cascade closure';
END $$;

-- ---------------------------------------------------------------------------
-- 5. THE DISPOSITION LITERALS, checked against the constraints themselves
-- ---------------------------------------------------------------------------
--
-- Each arm of the RPC's union declares what deleting the field does to that
-- kind of booking -- 'deleted' for ON DELETE CASCADE, 'unassigned' for ON
-- DELETE SET NULL. That is a hand-written literal describing a schema fact,
-- which is exactly the shape that goes stale. So it is not trusted: each arm
-- is parsed out of the function body, its table's FK to `fields` is looked up
-- in pg_constraint, and the two must agree. Change an ON DELETE rule without
-- changing the literal and this goes red.
DO $$
DECLARE
  v_def text; v_cte text; v_arms text[]; v_arm text;
  v_kind text; v_disp text; v_table text; v_del char; v_expected text;
  v_checked int := 0; v_n int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_delete_field';

  -- Sliced by position rather than by a regex over the whole body: the union
  -- is the text between the CTE header and the aggregate that consumes it, and
  -- a slice that failed to find either end is a failure here rather than an
  -- empty arm list that would pass every check below by iterating nothing.
  IF position('WITH affected AS (' in v_def) = 0
     OR position('INTO v_affected' in v_def) = 0 THEN
    RAISE EXCEPTION 'could not find the affected-booking union in admin_delete_field';
  END IF;
  v_cte := substring(v_def, position('WITH affected AS (' in v_def),
                     position('INTO v_affected' in v_def) - position('WITH affected AS (' in v_def));
  IF length(v_cte) < 100 THEN
    RAISE EXCEPTION 'the affected-booking union parsed as % characters; that is not the union', length(v_cte);
  END IF;

  v_arms := regexp_split_to_array(v_cte, 'UNION ALL');
  IF array_length(v_arms, 1) <> 5 THEN
    RAISE EXCEPTION 'expected 5 arms in the affected-booking union, parsed %', array_length(v_arms, 1);
  END IF;

  FOREACH v_arm IN ARRAY v_arms LOOP
    -- Dollar-quoted so the single quotes in the pattern are the ones that
    -- appear in the function body, not an escaping puzzle.
    v_kind  := (regexp_match(v_arm, $re$'([a-z_]+)'::text$re$))[1];
    v_table := (regexp_match(v_arm, $re$FROM public\.([a-z_]+)$re$))[1];
    IF v_kind IS NULL OR v_table IS NULL THEN
      RAISE EXCEPTION 'an arm of the union declares no kind (%) or table (%)', v_kind, v_table;
    END IF;

    -- **Two shapes of arm, and the difference is the point.** A CASCADE-only
    -- arm states one disposition word outright. An arm whose table reaches the
    -- field BOTH ways -- SET NULL on field_id and CASCADE through a slot --
    -- must decide per row, and states both words in a CASE. Checking only the
    -- first literal would have passed the version of this RPC that told the
    -- operator every assignment survives.
    IF v_arm LIKE '%CASE WHEN EXISTS%' THEN
      IF v_arm NOT LIKE $q$%'deleted'%$q$ OR v_arm NOT LIKE $q$%'unassigned'%$q$ THEN
        RAISE EXCEPTION 'arm % decides per row but does not offer both dispositions', v_kind;
      END IF;
      -- Its table must genuinely have both edges, or the CASE is decoration.
      SELECT count(*) INTO v_n
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid
        JOIN pg_namespace sn ON sn.oid = src.relnamespace AND sn.nspname = 'public'
       WHERE con.contype = 'f' AND src.relname = v_table AND con.confdeltype = 'c';
      IF v_n = 0 THEN
        RAISE EXCEPTION
          'arm % reports a per-row disposition but % has no CASCADE key that could destroy it',
          v_kind, v_table;
      END IF;
      v_checked := v_checked + 1;
      CONTINUE;
    END IF;

    v_disp := (regexp_match(v_arm, $re$'(deleted|unassigned)'::text$re$))[1];
    IF v_disp IS NULL THEN
      RAISE EXCEPTION 'arm % declares no disposition', v_kind;
    END IF;

    -- A flat 'deleted' must be backed by a CASCADE edge somewhere in the
    -- closure -- directly on field_id, or through the slot it joins.
    SELECT con.confdeltype INTO v_del
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_class tgt ON tgt.oid = con.confrelid
      JOIN pg_namespace sn ON sn.oid = src.relnamespace AND sn.nspname = 'public'
     WHERE con.contype = 'f' AND src.relname = v_table AND tgt.relname = 'fields'
       AND con.conkey = ARRAY[(SELECT a.attnum FROM pg_attribute a
                                WHERE a.attrelid = src.oid AND a.attname = 'field_id')]::smallint[];
    IF v_del IS NULL THEN
      -- No direct edge: the arm reaches the field through something else, so
      -- the destroying key is a CASCADE on that table (games -> game_slots).
      SELECT count(*) INTO v_n
        FROM pg_constraint con
        JOIN pg_class src ON src.oid = con.conrelid
        JOIN pg_namespace sn ON sn.oid = src.relnamespace AND sn.nspname = 'public'
       WHERE con.contype = 'f' AND src.relname = v_table AND con.confdeltype = 'c';
      IF v_n = 0 THEN
        RAISE EXCEPTION '% is enumerated as destroyed but has no CASCADE key at all', v_table;
      END IF;
      IF v_disp <> 'deleted' THEN
        RAISE EXCEPTION 'arm % reaches the field only by cascade but declares "%"', v_kind, v_disp;
      END IF;
      v_checked := v_checked + 1;
      CONTINUE;
    END IF;

    v_expected := CASE v_del WHEN 'c' THEN 'deleted' WHEN 'n' THEN 'unassigned' ELSE NULL END;
    IF v_expected IS NULL THEN
      RAISE EXCEPTION '%.field_id is ON DELETE %, which the RPC has no disposition word for', v_table, v_del;
    END IF;
    IF v_disp <> v_expected THEN
      RAISE EXCEPTION 'arm % (%) declares disposition "%" but %.field_id is ON DELETE % (expected "%")',
        v_kind, v_table, v_disp, v_table, v_del, v_expected;
    END IF;
    v_checked := v_checked + 1;
  END LOOP;

  IF v_checked <> 5 THEN
    RAISE EXCEPTION 'checked % dispositions, expected 5', v_checked;
  END IF;
  RAISE NOTICE 'disposition literals checked against pg_constraint on % arms', v_checked;
END $$;

-- ---------------------------------------------------------------------------
-- 6. THE RPC ITSELF, called rather than read, on all four booking kinds
-- ---------------------------------------------------------------------------
--
-- Sections 1-5 read the function. Reading it says nothing about what it does,
-- and PR 2's lesson was exactly that: planting a behavioural defect into
-- admin_retire_field left every structural assertion green. This calls it.
--
-- One booking of EACH of the four kinds is seeded on one field, so an arm
-- dropped from the union changes the count and fails here rather than being
-- absorbed by the other three.
DO $$
DECLARE
  v_org uuid; v_loc uuid; v_field uuid; v_bare uuid; v_user uuid := gen_random_uuid();
  v_season uuid; v_div uuid; v_team uuid;
  v_gs uuid; v_ga uuid; v_ps uuid; v_pa uuid;
  v_ga_slotted uuid; v_ga_orphan uuid; v_pa_slotted uuid; v_game uuid; v_team_b uuid;
  v_res jsonb; v_n int; v_kinds text[]; v_fk uuid; v_disp text;
BEGIN
  -- `password_length` satisfies check_password_length_on_auth_users from
  -- 20240405180000. Nothing here depends on a password.
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user, 'delete-guard@example.test', jsonb_build_object('password_length', 16))
  ON CONFLICT DO NOTHING;
  INSERT INTO public.organizations (name, slug) VALUES ('Delete Guard Org','delete-guard-org')
  RETURNING id INTO v_org;
  INSERT INTO public.profiles (id, email) VALUES (v_user, 'delete-guard@example.test')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.organization_members (organization_id, profile_id, role)
  VALUES (v_org, v_user, 'admin');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO public.locations (organization_id, name) VALUES (v_org, 'Guard Park')
  RETURNING id INTO v_loc;
  INSERT INTO public.fields (organization_id, location_id, name, active)
  VALUES (v_org, v_loc, 'Booked Pitch', true) RETURNING id INTO v_field;
  INSERT INTO public.fields (organization_id, location_id, name, active)
  VALUES (v_org, v_loc, 'Empty Pitch', true) RETURNING id INTO v_bare;

  -- practice_assignments.team_id is NOT NULL and references teams, so the
  -- fourth booking kind needs a team, which needs a division and a season.
  INSERT INTO public.season_settings (organization_id, name)
  VALUES (v_org, 'Guard Season') RETURNING id INTO v_season;
  INSERT INTO public.divisions (organization_id, season_settings_id, name)
  VALUES (v_org, v_season, 'Guard Division') RETURNING id INTO v_div;
  INSERT INTO public.teams (organization_id, division_id, name)
  VALUES (v_org, v_div, 'Guard Team') RETURNING id INTO v_team;

  INSERT INTO public.game_slots (organization_id, field_id, slot_date, week_index)
  VALUES (v_org, v_field, current_date + 7, 1) RETURNING id INTO v_gs;
  INSERT INTO public.practice_slots (organization_id, field_id, day_of_week, start_time, end_time, valid_until)
  VALUES (v_org, v_field, 'mon', '18:00', '19:30', current_date + 60) RETURNING id INTO v_ps;

  -- **Two shapes of assignment, deliberately.** The first draft of this smoke
  -- seeded only the FREE-STANDING shape -- an assignment with a field_id and no
  -- slot behind it -- and asserted "it survives with field_id NULL". That is a
  -- state the production path never produces: `persist_game_schedule` and
  -- `persist_practice_schedule` write the slot columns on every row, and those
  -- are ON DELETE CASCADE, so the real row is DESTROYED. Asserting the survival
  -- of a shape nothing writes is a test forging state the production path
  -- cannot reach -- coverage of nothing. Both shapes are seeded now, and the
  -- assertions below are different for each.
  INSERT INTO public.game_assignments (organization_id, field_id, game_slot_id, slot_id, "start", week_index)
  VALUES (v_org, v_field, v_gs, v_gs, timezone('utc', now()) + interval '7 days', 1)
  RETURNING id INTO v_ga_slotted;
  INSERT INTO public.game_assignments (organization_id, field_id, "start", week_index)
  VALUES (v_org, v_field, timezone('utc', now()) + interval '7 days', 1) RETURNING id INTO v_ga;
  -- **Reachable ONLY through its slot.** `field_id` is nullable, so a row can
  -- carry a slot on this ground and no field_id at all -- the shape an earlier
  -- delete's SET NULL leaves behind. The cascade does not consult field_id, so
  -- this is destroyed; an enumeration filtered on field_id alone would not
  -- mention it, and the operator would lose a booking nobody warned them about.
  INSERT INTO public.game_assignments (organization_id, field_id, game_slot_id, "start", week_index)
  VALUES (v_org, NULL, v_gs, timezone('utc', now()) + interval '7 days', 1)
  RETURNING id INTO v_ga_orphan;
  INSERT INTO public.practice_assignments (organization_id, team_id, field_id, practice_slot_id, slot_id, effective_date_range)
  VALUES (v_org, v_team, v_field, v_ps, v_ps, daterange(current_date, current_date + 60, '[]'))
  RETURNING id INTO v_pa_slotted;
  INSERT INTO public.practice_assignments (organization_id, team_id, field_id, effective_date_range)
  VALUES (v_org, v_team, v_field, daterange(current_date, current_date + 60, '[]'))
  RETURNING id INTO v_pa;

  -- `games` carries no field_id and dies with the slot, score and all.
  INSERT INTO public.teams (organization_id, division_id, name)
  VALUES (v_org, v_div, 'Guard Team B') RETURNING id INTO v_team_b;
  INSERT INTO public.games (organization_id, game_slot_id, home_team_id, away_team_id)
  VALUES (v_org, v_gs, v_team, v_team_b) RETURNING id INTO v_game;

  -- 6a. UNCONFIRMED delete of booked ground is REFUSED, names every kind, and
  --     writes nothing.
  v_res := public.admin_delete_field(v_org, v_field, false);
  IF (v_res->>'deleted')::boolean THEN
    RAISE EXCEPTION 'admin_delete_field deleted booked ground without confirmation: %', v_res; END IF;
  IF v_res->>'reason' <> 'bookings_exist' THEN
    RAISE EXCEPTION 'refusal did not name bookings_exist: %', v_res; END IF;
  -- 1 game_slot + 1 practice_slot + 3 game_assignments + 2 practice_assignments
  -- + 1 game = 8.
  IF (v_res->>'affected_count')::int <> 8 THEN
    RAISE EXCEPTION 'expected 8 affected rows across five kinds, got %: %',
      v_res->>'affected_count', v_res; END IF;

  SELECT array_agg(DISTINCT x->>'kind' ORDER BY x->>'kind') INTO v_kinds
    FROM jsonb_array_elements(v_res->'affected') x;
  IF v_kinds <> ARRAY['game','game_assignment','game_slot','practice_assignment','practice_slot'] THEN
    RAISE EXCEPTION 'the refusal named kinds %, expected all five', v_kinds; END IF;

  -- **The per-row disposition, on both shapes.** The slot-linked assignment is
  -- destroyed; the free-standing one is unassigned. A version that reported one
  -- word for the whole table would fail on whichever half it got wrong.
  SELECT x->>'disposition' INTO v_disp FROM jsonb_array_elements(v_res->'affected') x
   WHERE (x->>'id')::uuid = v_ga_slotted;
  IF v_disp IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 'a slot-linked game assignment is reported as "%", but the slot cascade destroys it', v_disp; END IF;
  SELECT x->>'disposition' INTO v_disp FROM jsonb_array_elements(v_res->'affected') x
   WHERE (x->>'id')::uuid = v_ga;
  IF v_disp IS DISTINCT FROM 'unassigned' THEN
    RAISE EXCEPTION 'a free-standing game assignment is reported as "%", expected unassigned', v_disp; END IF;
  SELECT x->>'disposition' INTO v_disp FROM jsonb_array_elements(v_res->'affected') x
   WHERE (x->>'id')::uuid = v_ga_orphan;
  IF v_disp IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 'an assignment reachable only through its slot is reported as "%", expected deleted', v_disp; END IF;
  SELECT x->>'disposition' INTO v_disp FROM jsonb_array_elements(v_res->'affected') x
   WHERE (x->>'id')::uuid = v_pa_slotted;
  IF v_disp IS DISTINCT FROM 'deleted' THEN
    RAISE EXCEPTION 'a slot-linked practice assignment is reported as "%", but the slot cascade destroys it', v_disp; END IF;
  SELECT x->>'disposition' INTO v_disp FROM jsonb_array_elements(v_res->'affected') x
   WHERE (x->>'id')::uuid = v_pa;
  IF v_disp IS DISTINCT FROM 'unassigned' THEN
    RAISE EXCEPTION 'a free-standing practice assignment is reported as "%", expected unassigned', v_disp; END IF;

  -- **Nothing was written.** A refusal that half-applied would be worse than no
  -- guard at all. Each booking is counted from ITS OWN table, never from the
  -- field, because the field is the row a break would remove.
  IF NOT EXISTS (SELECT 1 FROM public.fields WHERE id = v_field) THEN
    RAISE EXCEPTION 'a refused delete removed the field anyway'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_slots WHERE id = v_gs)
     OR NOT EXISTS (SELECT 1 FROM public.game_assignments WHERE id = v_ga)
     OR NOT EXISTS (SELECT 1 FROM public.game_assignments WHERE id = v_ga_slotted)
     OR NOT EXISTS (SELECT 1 FROM public.game_assignments WHERE id = v_ga_orphan)
     OR NOT EXISTS (SELECT 1 FROM public.practice_slots WHERE id = v_ps)
     OR NOT EXISTS (SELECT 1 FROM public.practice_assignments WHERE id = v_pa)
     OR NOT EXISTS (SELECT 1 FROM public.practice_assignments WHERE id = v_pa_slotted)
     OR NOT EXISTS (SELECT 1 FROM public.games WHERE id = v_game) THEN
    RAISE EXCEPTION 'a refused delete destroyed a booking'; END IF;

  -- The refusal is recorded, so an operator can see the decision that was
  -- refused and against what.
  SELECT count(*) INTO v_n FROM public.audit_log
   WHERE resource_id = v_field
     AND metadata->>'operation' = 'admin_delete_field'
     AND metadata->>'phase' = 'refused';
  IF v_n <> 1 THEN RAISE EXCEPTION 'expected 1 refused audit row, found %', v_n; END IF;

  -- 6b. UNBOOKED ground deletes with no confirmation. Without this the guard
  --     could be "refuse everything", which passes 6a and is not the contract.
  v_res := public.admin_delete_field(v_org, v_bare, false);
  IF NOT (v_res->>'deleted')::boolean THEN
    RAISE EXCEPTION 'admin_delete_field refused ground with no bookings: %', v_res; END IF;
  IF (v_res->>'affected_count')::int <> 0 THEN
    RAISE EXCEPTION 'unbooked ground reported % affected bookings', v_res->>'affected_count'; END IF;
  IF EXISTS (SELECT 1 FROM public.fields WHERE id = v_bare) THEN
    RAISE EXCEPTION 'a confirmed-unnecessary delete did not remove the field'; END IF;

  -- 6c. CONFIRMED delete proceeds, and each kind meets the disposition the RPC
  --     declared for it: slots destroyed, assignments kept and unassigned.
  v_res := public.admin_delete_field(v_org, v_field, true);
  IF NOT (v_res->>'deleted')::boolean THEN
    RAISE EXCEPTION 'a confirmed delete was refused: %', v_res; END IF;
  IF EXISTS (SELECT 1 FROM public.fields WHERE id = v_field) THEN
    RAISE EXCEPTION 'a confirmed delete left the field in place'; END IF;

  IF EXISTS (SELECT 1 FROM public.game_slots WHERE id = v_gs) THEN
    RAISE EXCEPTION 'game_slot survived a field delete; its FK is documented CASCADE'; END IF;
  IF EXISTS (SELECT 1 FROM public.practice_slots WHERE id = v_ps) THEN
    RAISE EXCEPTION 'practice_slot survived a field delete; its FK is documented CASCADE'; END IF;
  IF EXISTS (SELECT 1 FROM public.games WHERE id = v_game) THEN
    RAISE EXCEPTION 'the game survived; it cascades with its slot, and the RPC said so'; END IF;

  -- **The rows the RPC said would be DESTROYED really are.** This is the half
  -- the first draft got wrong in the operator's favour, promising survival.
  IF EXISTS (SELECT 1 FROM public.game_assignments WHERE id = v_ga_slotted) THEN
    RAISE EXCEPTION 'a slot-linked game assignment survived; the RPC reported it as deleted'; END IF;
  IF EXISTS (SELECT 1 FROM public.game_assignments WHERE id = v_ga_orphan) THEN
    RAISE EXCEPTION 'an assignment reachable only through its slot survived; the RPC reported it as deleted'; END IF;
  IF EXISTS (SELECT 1 FROM public.practice_assignments WHERE id = v_pa_slotted) THEN
    RAISE EXCEPTION 'a slot-linked practice assignment survived; the RPC reported it as deleted'; END IF;

  SELECT field_id INTO v_fk FROM public.game_assignments WHERE id = v_ga;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'game_assignment was destroyed by a field delete; its FK is documented SET NULL'; END IF;
  IF v_fk IS NOT NULL THEN
    RAISE EXCEPTION 'game_assignment.field_id is % after the field was deleted, expected NULL', v_fk; END IF;

  -- **The defect this migration exists for.** Before the foreign key, this
  -- column kept the deleted field's uuid and nothing downstream could tell it
  -- from a live venue.
  SELECT field_id INTO v_fk FROM public.practice_assignments WHERE id = v_pa;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'practice_assignment was destroyed by a field delete; its FK is documented SET NULL'; END IF;
  IF v_fk IS NOT NULL THEN
    RAISE EXCEPTION 'practice_assignment.field_id is % after the field was deleted -- it is DANGLING', v_fk; END IF;

  RAISE NOTICE 'delete guard exercised: 8 rows across 5 kinds refused, 1 unbooked field deleted, 1 confirmed delete with 6 destroyed and 2 unassigned';
  DELETE FROM public.organizations WHERE id = v_org;
  DELETE FROM auth.users WHERE id = v_user;
END $$;

-- ---------------------------------------------------------------------------
-- Reporting (evidence, not gates)
-- ---------------------------------------------------------------------------
-- **Zero here means "nothing to measure", not "healthy".** On the migration
-- harness's freshly built database there are no practice assignments at all,
-- so both figures below read 0 whatever the constraint does. They are worth
-- printing on a database with data in it; the GATE for the constraint is
-- section 3, which asserts the foreign key itself, and section 6, which
-- exercises it on rows this file creates.
select 'practice_assignments and their venues (0 rows means not exercised on real data)' as report,
       count(*) filter (where field_id is not null) as with_field,
       count(*) filter (where field_id is null) as without_field,
       count(*) as all_rows
from public.practice_assignments;

-- A nonzero count here after this migration would mean the constraint is not
-- doing its job; it is reported rather than gated because the gate for it is
-- the constraint itself, asserted in section 3.
select 'practice_assignments pointing at a field that does not exist (expect 0)' as report,
       count(*) as dangling
from public.practice_assignments pa
where pa.field_id is not null
  and not exists (select 1 from public.fields f where f.id = pa.field_id);
