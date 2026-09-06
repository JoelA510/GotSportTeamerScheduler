-- Smoke checks for 20260906000100_field_blackouts.sql
--
-- Assertions RAISE; evidence reports. See 20260906000000_smoke.sql for why.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Table, RLS, constraints
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_n int; v_using text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='public' AND c.relname='field_blackouts' AND c.relrowsecurity)
  THEN RAISE EXCEPTION 'RLS is not enabled on field_blackouts'; END IF;

  SELECT count(*) INTO v_n FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='field_blackouts';
  IF v_n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 policy on field_blackouts, found %', v_n; END IF;

  SELECT pg_get_expr(pol.polqual, pol.polrelid) INTO v_using
  FROM pg_policy pol JOIN pg_class c ON c.oid=pol.polrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='field_blackouts';
  IF v_using = 'true' THEN RAISE EXCEPTION 'field_blackouts policy is USING (true)'; END IF;

  -- FIVE, not four: the inline reason enum is named field_blackouts_reason_check
  -- and matches this pattern too. The first draft said four and an operator
  -- reading a correct run would have concluded the migration was wrong.
  SELECT count(*) INTO v_n FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
  JOIN pg_namespace n ON n.oid=t.relnamespace
  WHERE n.nspname='public' AND t.relname='field_blackouts' AND c.conname LIKE 'field_blackouts%check';
  IF v_n <> 5 THEN RAISE EXCEPTION 'expected 5 field_blackouts CHECK constraints, found %', v_n; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
                 JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname='public' AND c.relname='field_blackouts'
                   AND t.tgname='field_blackouts_set_timestamp')
  THEN RAISE EXCEPTION 'field_blackouts.updated_at has no maintaining trigger'; END IF;

  IF obj_description('public.field_blackout_windows'::regclass,'pg_class')
     NOT LIKE 'FROZEN as of 20260906000100%'
  THEN RAISE EXCEPTION 'field_blackout_windows does not carry the freeze comment'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The single reader
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_def text; v_opts text;
BEGIN
  SELECT pg_get_viewdef('public.field_closures'::regclass) INTO v_def;
  IF v_def IS NULL THEN RAISE EXCEPTION 'field_closures view missing'; END IF;
  IF v_def NOT LIKE '%field_blackouts%' THEN RAISE EXCEPTION 'field_closures does not read field_blackouts'; END IF;
  IF v_def NOT LIKE '%field_blackout_windows%' THEN RAISE EXCEPTION 'field_closures does not read field_blackout_windows'; END IF;

  SELECT COALESCE(array_to_string(c.reloptions, ','), '') INTO v_opts
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname='field_closures';
  IF v_opts NOT LIKE '%security_invoker=true%'
  THEN RAISE EXCEPTION 'field_closures is not security_invoker; it would hand every org its neighbours closures'; END IF;

  -- **Scope and derivation are DIFFERENT columns with different names.** One
  -- column meaning the blackout's scope on one arm and the field's location on
  -- the other made a location filter close every other pitch on the site.
  PERFORM 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='field_closures' AND column_name='closes_location_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'field_closures.closes_location_id missing'; END IF;
  PERFORM 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='field_closures' AND column_name='field_location_id';
  IF NOT FOUND THEN RAISE EXCEPTION 'field_closures.field_location_id missing'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_schema='public' AND table_name='field_closures' AND column_name='location_id')
  THEN RAISE EXCEPTION 'field_closures still exposes the two-meanings column location_id'; END IF;
  -- `note` is admin free text on BOTH arms; the import's words have their own name.
  PERFORM 1 FROM information_schema.columns
  WHERE table_schema='public' AND table_name='field_closures' AND column_name='source_reason_text';
  IF NOT FOUND THEN RAISE EXCEPTION 'field_closures.source_reason_text missing'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The import path is untouched -- the reason repointing was rejected
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='finalize_field_availability_import_job';
  IF v_def IS NULL THEN RAISE EXCEPTION 'finalize_field_availability_import_job missing'; END IF;
  IF v_def NOT LIKE '%INSERT INTO public.field_blackout_windows%'
  THEN RAISE EXCEPTION 'the import path no longer writes field_blackout_windows'; END IF;
  IF v_def LIKE '%INSERT INTO public.field_blackouts%'
  THEN RAISE EXCEPTION 'the import path writes field_blackouts; the two producers are no longer disjoint'; END IF;

  -- The FK PostgREST needs for the shipped nested embed (useFields.js:58).
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid
    JOIN pg_class r ON r.oid=c.confrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    WHERE n.nspname='public' AND t.relname='field_blackout_windows'
      AND r.relname='field_availability_profiles' AND c.contype='f')
  THEN RAISE EXCEPTION 'the profile -> blackout FK the nested embed depends on is gone'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- RPC hardening and grants
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, p.prosecdef, COALESCE(array_to_string(p.proconfig,','),'') AS cfg,
           pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('admin_create_field_blackout','admin_delete_field_blackout')
  LOOP
    IF NOT r.prosecdef THEN RAISE EXCEPTION '% is not SECURITY DEFINER', r.proname; END IF;
    IF r.cfg NOT LIKE '%search_path=public%' THEN RAISE EXCEPTION '% does not pin search_path', r.proname; END IF;
    IF r.def NOT LIKE '%is_org_admin%' THEN RAISE EXCEPTION '% does not gate on is_org_admin', r.proname; END IF;
    IF r.def NOT LIKE '%42501%' THEN RAISE EXCEPTION '% does not raise 42501', r.proname; END IF;
    IF r.def NOT LIKE '%''phase'', ''before''%' THEN RAISE EXCEPTION '% does not audit before', r.proname; END IF;
    IF r.def NOT LIKE '%''phase'', ''after''%' THEN RAISE EXCEPTION '% does not audit after', r.proname; END IF;
  END LOOP;

  IF has_function_privilege('public',
    'public.admin_create_field_blackout(uuid, uuid, uuid, date, date, integer, integer, text, text)','EXECUTE')
  THEN RAISE EXCEPTION 'PUBLIC must not execute admin_create_field_blackout'; END IF;
  IF NOT has_function_privilege('authenticated',
    'public.admin_create_field_blackout(uuid, uuid, uuid, date, date, integer, integer, text, text)','EXECUTE')
  THEN RAISE EXCEPTION 'authenticated must execute admin_create_field_blackout'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The scope rule, exercised on real rows
-- ---------------------------------------------------------------------------
--
-- The twin of smoke 1's invariant check, and it gets the same treatment: the
-- first draft asserted "no closure has a bad scope" over a table the migration
-- above it had just created empty. That is the vacuous shape check 8 exists to
-- catch, and the twin did not get it.
DO $$
DECLARE v_org uuid; v_loc uuid; v_field uuid; v_prof uuid; v_orphan uuid; v_n int; v_txt text;
BEGIN
  INSERT INTO public.organizations (name, slug) VALUES ('Smoke Org 8.4b','smoke-org-84b') RETURNING id INTO v_org;
  INSERT INTO public.locations (organization_id, name) VALUES (v_org,'Smoke Site') RETURNING id INTO v_loc;
  INSERT INTO public.fields (organization_id, location_id, name) VALUES (v_org, v_loc,'Smoke Pitch') RETURNING id INTO v_field;

  INSERT INTO public.field_blackouts (organization_id, location_id, field_id, blackout_from, blackout_until, reason)
  VALUES (v_org, v_loc, NULL, '2026-08-01','2026-08-31','maintenance');
  INSERT INTO public.field_blackouts (organization_id, location_id, field_id, blackout_from, blackout_until, reason)
  VALUES (v_org, NULL, v_field, '2026-09-01','2026-09-02','weather');

  -- Both scopes at once, and neither, are refused by the database.
  BEGIN
    INSERT INTO public.field_blackouts (organization_id, location_id, field_id, blackout_from, blackout_until)
    VALUES (v_org, v_loc, v_field, '2026-08-01','2026-08-31');
    RAISE EXCEPTION 'a blackout scoped to BOTH a site and a field was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.field_blackouts (organization_id, location_id, field_id, blackout_from, blackout_until)
    VALUES (v_org, NULL, NULL, '2026-08-01','2026-08-31');
    RAISE EXCEPTION 'a blackout scoped to NEITHER was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.field_blackouts (organization_id, location_id, field_id, blackout_from, blackout_until, reason)
    VALUES (v_org, NULL, v_field, '2026-08-01','2026-08-31','closure');
    RAISE EXCEPTION 'a blackout with an undeclared reason was accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- **The import arm, exercised on real rows too.**
  -- Everything above this line builds rows on ONE arm of the union. The
  -- harness proof planted two defects that live only on the OTHER arm -- the
  -- import arm reporting the field's site as a SCOPE, and `note` carrying the
  -- import's reason again -- and this smoke caught neither, because it had
  -- never put a row down that side. That is the same hollow shape check 8
  -- exists to catch: an assertion whose subject set is empty. Structural
  -- column checks cannot cover it either, since both defects keep every
  -- column name and change only what the column MEANS.
  --
  -- Two profiles, deliberately: one that resolves to ground, and one whose
  -- `field_id` is NULL. The second is the unification blocker itself, so it is
  -- exercised rather than only described in a comment.
  INSERT INTO public.field_availability_profiles
    (organization_id, season_label, field_id, location, field_name, available_from, available_until)
  VALUES (v_org, 'Smoke Season', v_field, 'Smoke Site', 'Smoke Pitch', '2026-01-01','2026-12-31')
  RETURNING id INTO v_prof;
  INSERT INTO public.field_availability_profiles
    (organization_id, season_label, field_id, location, field_name, available_from, available_until)
  VALUES (v_org, 'Smoke Season', NULL, 'Smoke Site', 'Unmatched Pitch', '2026-01-01','2026-12-31')
  RETURNING id INTO v_orphan;

  INSERT INTO public.field_blackout_windows (organization_id, profile_id, blackout_from, blackout_until, reason)
  VALUES (v_org, v_prof, '2026-10-01','2026-10-07','winter shutdown');
  INSERT INTO public.field_blackout_windows (organization_id, profile_id, blackout_from, blackout_until, reason)
  VALUES (v_org, v_orphan, '2026-10-01','2026-10-07','winter shutdown');

  -- The rows really landed, so the scope assertions below are not vacuous --
  -- and they landed on BOTH arms, which is the part that was missing.
  SELECT count(*) INTO v_n FROM public.field_closures WHERE organization_id = v_org;
  IF v_n <> 4 THEN RAISE EXCEPTION 'expected 4 closures for the smoke org (2 admin + 2 import), found %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.field_closures
  WHERE organization_id = v_org AND source = 'field_blackouts';
  IF v_n <> 2 THEN RAISE EXCEPTION 'expected 2 admin closures, found %', v_n; END IF;
  SELECT count(*) INTO v_n FROM public.field_closures
  WHERE organization_id = v_org AND source = 'field_blackout_windows';
  IF v_n <> 2 THEN RAISE EXCEPTION 'expected 2 import closures, found %', v_n; END IF;

  IF EXISTS (SELECT 1 FROM public.field_closures
             WHERE source='field_blackouts' AND num_nonnulls(closes_location_id, closes_field_id) <> 1)
  THEN RAISE EXCEPTION 'an admin closure has a scope that is neither or both'; END IF;

  -- **Scope is not derivation.** The site-wide row closes the site; the
  -- field-scoped row must NOT report the site as its scope, or a
  -- location-filtered query closes every other pitch on it.
  SELECT count(*) INTO v_n FROM public.field_closures
  WHERE organization_id = v_org AND closes_location_id = v_loc;
  IF v_n <> 1 THEN RAISE EXCEPTION 'expected exactly 1 site-scoped closure, found % -- scope and derivation are confused', v_n; END IF;

  SELECT count(*) INTO v_n FROM public.field_closures
  WHERE organization_id = v_org AND source = 'field_blackouts'
    AND closes_field_id = v_field AND field_location_id = v_loc;
  IF v_n <> 1 THEN RAISE EXCEPTION 'the field-scoped admin closure does not carry its field location'; END IF;

  -- **An import window is never site-scoped.** It hangs off a profile and
  -- shuts that profile's ground. Reporting the field's site in the SCOPE
  -- column is the two-meanings defect wearing the other arm's clothes: a
  -- location-filtered query would then shut every other pitch on the site.
  SELECT count(*) INTO v_n FROM public.field_closures
  WHERE organization_id = v_org AND source = 'field_blackout_windows'
    AND closes_location_id IS NOT NULL;
  IF v_n <> 0 THEN RAISE EXCEPTION
    'an import closure reports a site as its SCOPE (% rows) -- scope and derivation are confused on the import arm', v_n; END IF;

  -- Derivation still travels, under its own name, on the row that resolved.
  SELECT count(*) INTO v_n FROM public.field_closures
  WHERE organization_id = v_org AND source = 'field_blackout_windows'
    AND closes_field_id = v_field AND field_location_id = v_loc;
  IF v_n <> 1 THEN RAISE EXCEPTION 'the resolved import closure lost its field location'; END IF;

  -- **The import's words stay in source_reason_text, and `note` stays admin
  -- prose.** If they swap, an enum filter drops every import row silently and
  -- PR 1's privacy guard over `note` erases the import's only statement of
  -- why. Asserted on the resolved row, whose text is known exactly.
  SELECT note INTO v_txt FROM public.field_closures
  WHERE organization_id = v_org AND source = 'field_blackout_windows' AND closes_field_id = v_field;
  IF v_txt IS NOT NULL THEN RAISE EXCEPTION
    'an import closure put text in note (%); note is admin free text on both arms', v_txt; END IF;
  SELECT source_reason_text INTO v_txt FROM public.field_closures
  WHERE organization_id = v_org AND source = 'field_blackout_windows' AND closes_field_id = v_field;
  IF v_txt IS DISTINCT FROM 'winter shutdown' THEN RAISE EXCEPTION
    'the import reason did not arrive in source_reason_text (got %)', v_txt; END IF;

  -- The admin arm is the mirror: its own words in note, nothing in the
  -- import-only column. Both directions, so neither assertion passes by the
  -- column simply being empty everywhere.
  IF EXISTS (SELECT 1 FROM public.field_closures
             WHERE organization_id = v_org AND source = 'field_blackouts'
               AND source_reason_text IS NOT NULL)
  THEN RAISE EXCEPTION 'an admin closure carries source_reason_text; that column belongs to the import arm'; END IF;
  IF EXISTS (SELECT 1 FROM public.field_closures
             WHERE organization_id = v_org AND source = 'field_blackouts' AND reason IS NULL)
  THEN RAISE EXCEPTION 'an admin closure lost its structured reason'; END IF;
  IF EXISTS (SELECT 1 FROM public.field_closures
             WHERE organization_id = v_org AND source = 'field_blackout_windows' AND reason IS NOT NULL)
  THEN RAISE EXCEPTION 'an import closure invented a structured reason it was never given'; END IF;

  -- All-day on the import arm, checked rather than assumed.
  IF EXISTS (SELECT 1 FROM public.field_closures
             WHERE organization_id = v_org AND source = 'field_blackout_windows'
               AND num_nonnulls(start_minutes, end_minutes) > 0)
  THEN RAISE EXCEPTION 'an import closure carries clock times the import never recorded'; END IF;

  -- **The blocker is surfaced, not filtered.** The window whose profile
  -- resolved to no field must still appear, with a NULL scope on both axes --
  -- an inner join would have hidden a closure nobody can attribute.
  SELECT count(*) INTO v_n FROM public.field_closures
  WHERE organization_id = v_org AND source = 'field_blackout_windows'
    AND closes_field_id IS NULL AND closes_location_id IS NULL;
  IF v_n <> 1 THEN RAISE EXCEPTION
    'expected 1 unattributable import closure to be surfaced, found % -- an inner join is hiding the unification blocker', v_n; END IF;

  RAISE NOTICE 'scope rule exercised on 2 admin + 2 import closures accepted and 3 refused';
  DELETE FROM public.organizations WHERE id = v_org;
END $$;

-- ---------------------------------------------------------------------------
-- Reporting (evidence, not gates)
-- ---------------------------------------------------------------------------
select 'import closures no field-scoped query can attribute (THE unification blocker)' as report,
       count(*) filter (where source='field_blackout_windows' and closes_field_id is null) as unattributable_import,
       count(*) filter (where source='field_blackout_windows') as import_closures,
       count(*) filter (where source='field_blackouts' and closes_location_id is not null) as site_wide_admin,
       count(*) as total
from public.field_closures;
