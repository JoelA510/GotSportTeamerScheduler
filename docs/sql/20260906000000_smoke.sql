-- Smoke checks for 20260906000000_field_effective_dating.sql
--
-- **These ASSERT rather than report.** A smoke made of bare SELECTs exits 0
-- whatever it prints, so it only works if a human reads every number correctly
-- -- and a review round already caught an operator-facing header that said
-- "expect 4 rows" where a correct run returns 5. Invariants now RAISE, so
-- `scripts/dbharness/run.sh` can prove they fail when the defect is planted.
-- Figures that are evidence rather than gates stay as reporting SELECTs and are
-- labelled as such.

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='fields' AND column_name='effective_to'
      AND data_type='date'
  ) THEN RAISE EXCEPTION 'fields.effective_to missing or not a date'; END IF;

  -- effective_from was dropped rather than shipped as a column with no writer.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='fields' AND column_name='effective_from'
  ) THEN RAISE EXCEPTION 'fields.effective_from exists; it has no writer and no reader'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname='public' AND tablename='fields'
      AND indexname='idx_fields_effective_to'
  ) THEN RAISE EXCEPTION 'idx_fields_effective_to missing'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname='fields' AND t.tgname='fields_retirement_deactivates'
  ) THEN RAISE EXCEPTION 'fields_retirement_deactivates trigger missing'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The one producer of "is this field live", and its volatility
-- ---------------------------------------------------------------------------
DO $$
DECLARE v_vol char;
BEGIN
  SELECT p.provolatile INTO v_vol FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='field_is_live_on';
  IF v_vol IS NULL THEN RAISE EXCEPTION 'field_is_live_on missing'; END IF;
  -- **STABLE, not IMMUTABLE.** It reads current_date. Declared IMMUTABLE it is
  -- legal in index expressions and CHECK constraints and may be constant-folded
  -- into a cached plan -- a wrong answer that outlives the transaction.
  IF v_vol <> 's' THEN
    RAISE EXCEPTION 'field_is_live_on is volatility %, expected s (STABLE); it reads current_date', v_vol;
  END IF;

  -- Inclusive on the end date, and unbounded when NULL.
  IF NOT public.field_is_live_on(NULL) THEN RAISE EXCEPTION 'NULL window must be live'; END IF;
  IF NOT public.field_is_live_on(DATE '2026-06-30', DATE '2026-06-30') THEN
    RAISE EXCEPTION 'the end date itself must be live (inclusive)'; END IF;
  IF public.field_is_live_on(DATE '2026-06-30', DATE '2026-07-01') THEN
    RAISE EXCEPTION 'the day after the end date must not be live'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Hardening, grants, audit shape
-- ---------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.prosecdef,
           COALESCE(array_to_string(p.proconfig, ','), '') AS cfg,
           pg_get_functiondef(p.oid) AS def
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('admin_retire_field','admin_unretire_field')
  LOOP
    IF NOT r.prosecdef THEN RAISE EXCEPTION '% is not SECURITY DEFINER', r.proname; END IF;
    IF r.cfg NOT LIKE '%search_path=public%' THEN RAISE EXCEPTION '% does not pin search_path', r.proname; END IF;
    IF r.def NOT LIKE '%is_org_admin%' THEN RAISE EXCEPTION '% does not gate on is_org_admin', r.proname; END IF;
    IF r.def NOT LIKE '%42501%' THEN RAISE EXCEPTION '% does not raise 42501', r.proname; END IF;
    IF r.def NOT LIKE '%''phase'', ''before''%' THEN RAISE EXCEPTION '% does not audit before', r.proname; END IF;
    IF r.def NOT LIKE '%''phase'', ''after''%' THEN RAISE EXCEPTION '% does not audit after', r.proname; END IF;
  END LOOP;

  IF has_function_privilege('public','public.admin_retire_field(uuid, uuid, date, boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'PUBLIC must not execute admin_retire_field'; END IF;
  IF NOT has_function_privilege('authenticated','public.admin_retire_field(uuid, uuid, date, boolean)','EXECUTE') THEN
    RAISE EXCEPTION 'authenticated must execute admin_retire_field'; END IF;

  -- The refusal lives in the RPC, not only in the UI.
  IF (SELECT pg_get_functiondef(p.oid) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname='admin_retire_field')
     NOT LIKE '%bookings_after_effective_to%' THEN
    RAISE EXCEPTION 'admin_retire_field does not name its refusal reason'; END IF;
END $$;

-- ---------------------------------------------------------------------------
-- THE INVARIANT, exercised on real rows rather than asserted over an empty set
-- ---------------------------------------------------------------------------
--
-- The first draft asserted "no field has a past retirement while active" over
-- whatever happened to be in the table -- which on a freshly migrated database
-- is nothing, so it passed vacuously on exactly the run it first meets. This
-- CREATES the rows the invariant is about, so the check cannot be vacuous.
DO $$
DECLARE v_org uuid; v_loc uuid; v_field uuid; v_active boolean; v_eff date;
BEGIN
  INSERT INTO public.organizations (name, slug) VALUES ('Smoke Org 8.4', 'smoke-org-84')
  RETURNING id INTO v_org;
  INSERT INTO public.locations (organization_id, name) VALUES (v_org, 'Smoke Park')
  RETURNING id INTO v_loc;

  -- 1. A PAST retirement must deactivate.
  INSERT INTO public.fields (organization_id, location_id, name, active, effective_to)
  VALUES (v_org, v_loc, 'Past Retired', true, current_date - 1) RETURNING id, active INTO v_field, v_active;
  IF v_active THEN RAISE EXCEPTION 'a field retired yesterday is still active'; END IF;

  -- 2. A FUTURE retirement must NOT deactivate -- the round-1 defect.
  INSERT INTO public.fields (organization_id, location_id, name, active, effective_to)
  VALUES (v_org, v_loc, 'Future Retired', true, current_date + 30) RETURNING active INTO v_active;
  IF NOT v_active THEN
    RAISE EXCEPTION 'a field retired in 30 days was deactivated today, for a period reported unaffected';
  END IF;

  -- 3. Ordinary deactivation with NO date is untouched: the invariant is
  --    ONE-DIRECTIONAL and asserting the converse would call this a defect.
  INSERT INTO public.fields (organization_id, location_id, name, active, effective_to)
  VALUES (v_org, v_loc, 'Just Inactive', false, NULL) RETURNING active, effective_to INTO v_active, v_eff;
  IF v_active OR v_eff IS NOT NULL THEN RAISE EXCEPTION 'ordinary deactivation was altered'; END IF;

  -- 4. An UPDATE that tries to reactivate a past-retired field is refused by
  --    the trigger -- the admin_update_field(p_active => true) path.
  UPDATE public.fields SET active = true WHERE id = v_field;
  SELECT active INTO v_active FROM public.fields WHERE id = v_field;
  IF v_active THEN RAISE EXCEPTION 'a past-retired field was reactivated by an ordinary update'; END IF;

  -- 5. **The invariant is a WRITE-TIME one, and the earlier draft of this
  --    check did not say so.** It raised on any field anywhere whose
  --    retirement date had passed while `active` was still true -- a state the
  --    design deliberately produces and the clock alone reaches. Retire a
  --    field for the 1st with `active = true` (correct: it plays until then),
  --    touch nothing, and on the 2nd the row matches the "defect" pattern
  --    exactly. The gate would have gone red on a healthy database for no
  --    reason but time passing, which is how a smoke teaches its operator to
  --    ignore it.
  --
  --    `active` is a cache the trigger maintains at every write; `effective_to`
  --    read through `field_is_live_on` is the authority. So the gate is scoped
  --    to rows written in this block, where the trigger certainly ran, and the
  --    decayed population is REPORTED at the foot of this file instead, where a
  --    nonzero count is expected drift rather than a failure.
  IF EXISTS (
    SELECT 1 FROM public.fields
    WHERE organization_id = v_org
      AND effective_to IS NOT NULL AND effective_to < current_date AND active IS TRUE
  ) THEN RAISE EXCEPTION 'a field written in this block has a past retirement and is still active'; END IF;

  -- 6. The decay itself, exhibited rather than described. No clock can be
  --    wound forward here, so it is shown through the authority function: the
  --    future-retired field is NOT live as of the day after its retirement,
  --    while its cached `active` still reads true. That divergence IS the
  --    decay, and it is why a consumer must ask `field_is_live_on` rather than
  --    trust `active` alone. A reader that trusts the cache keeps scheduling on
  --    ground that closed.
  SELECT active, effective_to INTO v_active, v_eff FROM public.fields
  WHERE organization_id = v_org AND name = 'Future Retired';
  IF v_eff IS NULL THEN RAISE EXCEPTION 'the future-retired smoke field lost its date'; END IF;
  IF NOT v_active THEN RAISE EXCEPTION 'the future-retired smoke field is not active today'; END IF;
  IF public.field_is_live_on(v_eff, v_eff + 1) THEN
    RAISE EXCEPTION 'field_is_live_on reports a field live the day AFTER its retirement'; END IF;

  RAISE NOTICE 'invariant exercised on 3 constructed fields, an update, and the decay case';
  DELETE FROM public.organizations WHERE id = v_org;
END $$;

-- ---------------------------------------------------------------------------
-- THE RPCs THEMSELVES, called rather than read
-- ---------------------------------------------------------------------------
--
-- The checks above exercise the TRIGGER. They said nothing about the RPC
-- bodies, so planting "retire deactivates unconditionally" into
-- admin_retire_field left every assertion green -- the defect that started this
-- round, invisible to the smoke written for it. These call the RPCs.
--
-- `is_org_admin` needs a member row and a session subject, so the smoke creates
-- both and sets the GUC the harness's auth.uid() reads.
DO $$
DECLARE
  v_org uuid; v_loc uuid; v_field uuid; v_user uuid := gen_random_uuid();
  v_res jsonb; v_active boolean; v_eff date;
BEGIN
  -- `password_length` satisfies the check_password_length_on_auth_users trigger
  -- from 20240405180000. Nothing here depends on a password; the field exists
  -- so the insert is not refused for a reason unrelated to what is tested.
  INSERT INTO auth.users (id, email, raw_user_meta_data)
  VALUES (v_user, 'smoke@example.test', jsonb_build_object('password_length', 16))
  ON CONFLICT DO NOTHING;
  INSERT INTO public.organizations (name, slug) VALUES ('Smoke Org RPC','smoke-org-rpc')
  RETURNING id INTO v_org;
  INSERT INTO public.profiles (id, email) VALUES (v_user, 'smoke@example.test')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.organization_members (organization_id, profile_id, role)
  VALUES (v_org, v_user, 'admin');
  PERFORM set_config('request.jwt.claim.sub', v_user::text, true);

  INSERT INTO public.locations (organization_id, name) VALUES (v_org,'RPC Park') RETURNING id INTO v_loc;

  -- 1. A FUTURE retirement through the RPC leaves the field active.
  INSERT INTO public.fields (organization_id, location_id, name, active)
  VALUES (v_org, v_loc, 'RPC Future', true) RETURNING id INTO v_field;
  v_res := public.admin_retire_field(v_org, v_field, current_date + 30, false);
  IF NOT (v_res->>'retired')::boolean THEN RAISE EXCEPTION 'retire refused with no bookings: %', v_res; END IF;
  SELECT active, effective_to INTO v_active, v_eff FROM public.fields WHERE id = v_field;
  IF NOT v_active THEN
    RAISE EXCEPTION 'admin_retire_field deactivated a field retired in 30 days'; END IF;
  IF v_eff <> current_date + 30 THEN RAISE EXCEPTION 'effective_to not set by the RPC'; END IF;

  -- 2. Retiring an ALREADY-INACTIVE field must not reactivate it. A retirement
  --    can only ever remove activity.
  INSERT INTO public.fields (organization_id, location_id, name, active)
  VALUES (v_org, v_loc, 'RPC Already Off', false) RETURNING id INTO v_field;
  PERFORM public.admin_retire_field(v_org, v_field, current_date + 30, false);
  SELECT active INTO v_active FROM public.fields WHERE id = v_field;
  IF v_active THEN
    RAISE EXCEPTION 'retiring an already-deactivated field handed it back to the scheduler'; END IF;

  -- 3. Unretiring clears the date and does NOT invent activity it never removed.
  v_res := public.admin_unretire_field(v_org, v_field);
  SELECT active, effective_to INTO v_active, v_eff FROM public.fields WHERE id = v_field;
  IF v_eff IS NOT NULL THEN RAISE EXCEPTION 'unretire did not clear effective_to'; END IF;
  IF v_active THEN
    RAISE EXCEPTION 'unretire reactivated a field it never deactivated, discarding an operator decision'; END IF;

  -- 4. A PAST retirement through the RPC does deactivate.
  INSERT INTO public.fields (organization_id, location_id, name, active)
  VALUES (v_org, v_loc, 'RPC Past', true) RETURNING id INTO v_field;
  PERFORM public.admin_retire_field(v_org, v_field, current_date - 1, false);
  SELECT active INTO v_active FROM public.fields WHERE id = v_field;
  IF v_active THEN RAISE EXCEPTION 'a field retired yesterday through the RPC is still active'; END IF;

  RAISE NOTICE 'admin_retire_field / admin_unretire_field exercised on 3 fields';
  DELETE FROM public.organizations WHERE id = v_org;
  DELETE FROM auth.users WHERE id = v_user;
END $$;

-- ---------------------------------------------------------------------------
-- Reporting (evidence, not gates)
-- ---------------------------------------------------------------------------
select 'the subset the invariant applies to (0 means it has not been exercised on real data)' as report,
       count(*) filter (where effective_to is not null and effective_to < current_date) as past_retired,
       count(*) filter (where effective_to is not null) as dated_fields,
       count(*) as all_fields
from public.fields;

select 'fields deactivated without a retirement date (legitimate, NOT a defect)' as report,
       count(*) as deactivated_without_date
from public.fields where active is false and effective_to is null;

-- **Decayed rows: expected, not a defect.** A field retired for a future date
-- is correctly left active, and nothing rewrites it when that date passes --
-- the trigger fires on write, not on the clock. So a healthy database
-- accumulates rows whose retirement is past while `active` still reads true.
-- This is reporting, deliberately, because gating on it would go red purely
-- because a day went by. Any write to such a row re-runs the trigger and
-- settles it; until then `public.field_is_live_on(effective_to)` is the
-- authority and `active` is a stale cache. A consumer reading `active` alone
-- is the actual defect this number helps you find.
select 'retirement dates that have passed since their last write (expected drift)' as report,
       count(*) filter (where active is true) as still_cached_active,
       count(*) as past_retired
from public.fields
where effective_to is not null and effective_to < current_date;
