-- M1: effective dating on fields, and the retirement RPC that writes it.
--
-- Phase 8.4 PR 2 of 3. Gives `fields` an inclusive effective window mirroring
-- `packages/core/src/facility/lifecycle.js`, and adds `admin_retire_field`,
-- which refuses to retire ground that still has bookings unless the caller
-- confirms.
--
-- ## Why `active` survives, and is written together with `effective_to`
--
-- `fields.active` is not redundant here and removing it would be a live
-- regression: the shipped MVP scheduler filters on it directly at
-- `frontend/src/pages/GameSchedulingPage.jsx:253`
-- (`.eq('active', true)`), so a field retired by date alone would stay in the
-- scheduler's list of bookable ground. Until that read is repointed -- PR 3's
-- work, not this one -- the two columns must agree.
--
-- Two columns saying one thing is a hazard, and this migration has now bounded
-- it wrongly twice. The first draft claimed the two RPCs below are "the only
-- writers of `active`". The second said FOUR pre-existing writers and then
-- listed three, counting only UPDATE sites and forgetting that an INSERT
-- writes the column too.
--
-- **FIVE pre-existing writers of `fields.active`, two of them INSERTs:**
--
--   * 20260503070000_field_import_apply_rollback.sql:445   INSERT (import apply)
--   * 20260503070000_field_import_apply_rollback.sql:509   UPDATE (import apply)
--   * 20260503070000_field_import_apply_rollback.sql:1079  UPDATE (import rollback)
--   * 20260504060000_admin_facility_mutation_rpcs.sql:154  INSERT (admin_create_field)
--   * 20260504060000_admin_facility_mutation_rpcs.sql:266  UPDATE (admin_update_field)
--   * plus the two RPCs in this file -- seven in total.
--
-- The behaviour was already right, because the trigger fires on INSERT as well
-- as UPDATE. But the ENUMERATION was the justification for the trigger, and a
-- miscounted enumeration is a weaker argument than no enumeration -- it invites
-- the reader to trust a number nobody checked. Recorded plainly because
-- enumerating the family late is the lesson this phase keeps re-learning, and
-- the enumerations need checking as carefully as the fixes.
--
-- `admin_update_field(p_active => true)` on a retired field would set it active
-- while `effective_to` stayed in the past -- putting formally retired ground
-- back in the scheduler's list. Trusting every writer to remember the pairing
-- is exactly the "one rule, N call sites" shape this phase keeps finding.
--
-- So the invariant is enforced by the DATABASE, once, in a trigger -- not by
-- convention across the RPCs and whatever writes `fields` next.
--
-- **What the trigger does NOT give you, stated because the first draft claimed
-- it did.** The trigger fires on write; its predicate reads `current_date`. A
-- field retired with a FUTURE date is written `active = true` and stays that
-- way until something writes the row again -- so on the day the retirement
-- takes effect, `active` is stale until the next write. `active` is therefore
-- a WRITE-TIME CACHE of the date, not a continuously-true derivation, and the
-- authoritative answer to "is this field live on date D" is
-- `field_is_live_on(effective_to, D)` -- the same reading `isLiveOn()` gives in
-- `packages/core/src/facility/lifecycle.js`. Repointing the scheduler onto that
-- is PR 3's work; until then a future-dated retirement is honoured by the
-- lifecycle layer and not yet by the `.eq('active', true)` filter.
--
-- The smoke therefore checks what is true -- the invariant holds for
-- retirements already in the past -- rather than the "impossible to fail"
-- the first draft claimed.
--
-- The invariant is ONE-DIRECTIONAL, and saying so matters: a field whose
-- `effective_to` has passed must not be active. The converse is NOT required.
-- `active` predates dating and means "deactivated", which is broader than
-- "retired on a date" -- every field deactivated through `admin_update_field`
-- before this migration has `active = false` with a NULL `effective_to`, and
-- that is a healthy state, not a hazard. Asserting the biconditional would have
-- reported every one of them as a defect.
--
-- Deprecating `active` is recorded as follow-on work, not done here.
--
-- ## Audit before AND after
--
-- This diverges from the four existing facility RPCs in
-- `20260504060000_admin_facility_mutation_rpcs.sql`, which audit only the
-- resulting state. A retirement is a decision taken against a world the
-- operator believed in, and "what did it look like before" is the half that
-- makes the decision reviewable -- particularly when the RPC refused. Those
-- four are deliberately NOT retrofitted here: changing the audit shape of
-- shipped RPCs under a lifecycle migration is how a rider becomes an incident.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. The columns
-- ---------------------------------------------------------------------------

-- **Only `effective_to`.** An `effective_from` was in the first draft and is
-- deliberately absent: nothing in this PR or anywhere else would have written
-- or read it, and CLAUDE.md's rule is honour it or delete it. A column with an
-- index and a CHECK and no writer reads as load-bearing while being decoration,
-- which is how the board waiver was lost. It belongs with the adapter that maps
-- `fields` onto `facility/` nodes, which does not exist yet.
ALTER TABLE public.fields
  ADD COLUMN IF NOT EXISTS effective_to date;

COMMENT ON COLUMN public.fields.effective_to IS
  'Inclusive last date this field is part of the estate. NULL means unbounded. Written only by admin_retire_field/admin_unretire_field, always together with fields.active.';
COMMENT ON COLUMN public.fields.active IS
  'Kept alongside effective_to because the shipped scheduler filters on it (GameSchedulingPage.jsx). The two are written together and must never disagree; see docs/sql/20260906000000_smoke.sql. Deprecation is follow-on work.';

CREATE INDEX IF NOT EXISTS idx_fields_effective_to
  ON public.fields (organization_id, effective_to)
  WHERE effective_to IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. The invariant, enforced once
-- ---------------------------------------------------------------------------
--
-- A field whose effective_to has passed is not active, whichever of the four
-- writers of `active` last touched the row. One enforcer beats four
-- conventions: `admin_update_field(p_active => true)` on a retired field is a
-- real path today, and it would otherwise hand retired ground back to the
-- scheduler.
--
-- One-directional by design. `active = false` with a NULL effective_to is
-- ordinary deactivation and is left exactly alone.

-- **The one producer of "is this field live, given its dates".**
--
-- Three arms derived this independently in the first draft -- the trigger, the
-- retire RPC and the unretire RPC -- and the retire arm got it wrong: it set
-- `active = false` unconditionally, so a retirement dated six months out
-- removed the field from the scheduler TODAY, for the entire period the same
-- RPC had just reported as unaffected. The RPC contradicted its own report.
--
-- `active` follows the DATE, not the intent to retire.
-- **STABLE, not IMMUTABLE.** It reads `current_date` when `p_on` is omitted.
-- Declared IMMUTABLE it would be legal in an index expression and in a CHECK
-- constraint, and PostgreSQL may constant-fold it into a cached plan -- a wrong
-- answer that outlives the transaction that computed it. The smoke asserts the
-- volatility rather than trusting this comment.
CREATE OR REPLACE FUNCTION public.field_is_live_on(p_effective_to date, p_on date DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_effective_to IS NULL OR p_effective_to >= COALESCE(p_on, current_date);
$$;

COMMENT ON FUNCTION public.field_is_live_on(date, date) IS
  'The single reading of a field effective window in SQL, mirroring isLiveOn() in packages/core/src/facility/lifecycle.js. Inclusive: a field retired ON a date is live that day.';

CREATE OR REPLACE FUNCTION public.enforce_field_retirement_deactivates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF NOT public.field_is_live_on(NEW.effective_to) THEN
        NEW.active := false;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS fields_retirement_deactivates ON public.fields;
CREATE TRIGGER fields_retirement_deactivates
  BEFORE INSERT OR UPDATE ON public.fields
  FOR EACH ROW EXECUTE FUNCTION public.enforce_field_retirement_deactivates();

COMMENT ON FUNCTION public.enforce_field_retirement_deactivates() IS
  'Holds fields.active and fields.effective_to to their one-directional invariant: a field retired on a past date is never active. Enforced here, on INSERT and UPDATE, rather than in each of the seven sites that write fields.active.';

-- ---------------------------------------------------------------------------
-- 3. admin_retire_field
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_retire_field(
    p_organization_id uuid,
    p_field_id uuid,
    p_effective_to date,
    p_confirm boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before public.fields%ROWTYPE;
    v_after  public.fields%ROWTYPE;
    v_affected jsonb;
    v_affected_count integer;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;
    IF p_field_id IS NULL THEN
        RAISE EXCEPTION 'p_field_id is required' USING ERRCODE = '22023';
    END IF;
    IF p_effective_to IS NULL THEN
        RAISE EXCEPTION 'p_effective_to is required; retiring with no end date is a deletion, not a retirement'
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_before
    FROM public.fields
    WHERE id = p_field_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Field % not found in organization %', p_field_id, p_organization_id
            USING ERRCODE = 'P0002';
    END IF;

    -- **Every booking a retirement would strand -- all FOUR tables.**
    --
    -- The family, enumerated from the schema by script rather than from memory.
    -- SEVEN tables in this repo carry a `field_id`, not five as an earlier
    -- draft of this comment claimed -- the enumeration was itself miscounted,
    -- which is the same failure it was written to prevent. Four are bookings
    -- and are read below:
    --   * game_slots          (NOT NULL FK, ON DELETE CASCADE)
    --   * practice_slots      (NOT NULL FK, ON DELETE CASCADE)
    --   * game_assignments    (FK ON DELETE SET NULL, added 20260503030000)
    --   * practice_assignments(no FK at all -- a bare uuid column)
    -- Three are not, and each is excluded for a stated reason rather than by
    -- having been forgotten:
    --   * field_subunits              -- the estate's own structure. A subunit
    --     is part of the field, not a booking on it, and it cascades on delete.
    --     Note practice_slots.field_subunit_id: a practice slot scoped to a
    --     HALF pitch still carries the parent's field_id (NOT NULL), so it is
    --     caught by the practice_slots arm and needs no separate one.
    --   * field_availability_profiles -- import metadata describing the ground,
    --     not a use of it. A retirement does not strand a description.
    --   * field_blackouts             -- a closure, not a booking. Retiring a
    --     field cannot strand the statement that it was already shut, and the
    --     rows cascade with the field.
    --
    -- The first two drafts consulted the SLOT tables only. The ASSIGNMENT
    -- tables are where the persisted schedule lives -- `useGameAssignments.js`
    -- reads game_assignments directly -- so a retirement could report
    -- `affected_count: 0` while stranding every assigned game on that ground.
    -- That guts the acceptance criterion: "refused with the list of affected
    -- bookings" means nothing if the RPC does not look where bookings are.
    --
    -- Dates: a game slot's is `slot_date` falling back to `start` (the import
    -- writes slot_date and never start, 20260503070000:738); an assignment's is
    -- its own `start`; a practice slot's is `valid_until`; a practice
    -- assignment's is the upper bound of its `effective_date_range`.
    --
    -- `undated` means COULD NOT BE JUDGED. `unbounded` means runs forever and
    -- is therefore CERTAINLY stranded -- a different answer, not a missing one.
    WITH affected AS (
      SELECT 'game_slot'::text AS kind, gs.id,
             COALESCE(gs.slot_date, gs.start::date) AS on_date,
             gs.week_index::integer AS week_index,
             COALESCE(gs.slot_date, gs.start::date) IS NULL AS undated,
             false AS unbounded
      FROM public.game_slots gs
      WHERE gs.organization_id = p_organization_id AND gs.field_id = p_field_id
        AND (COALESCE(gs.slot_date, gs.start::date) IS NULL
             OR COALESCE(gs.slot_date, gs.start::date) > p_effective_to)
      UNION ALL
      SELECT 'game_assignment'::text, ga.id,
             ga.start::date, ga.week_index::integer,
             ga.start IS NULL, false
      FROM public.game_assignments ga
      WHERE ga.organization_id = p_organization_id AND ga.field_id = p_field_id
        AND (ga.start IS NULL OR ga.start::date > p_effective_to)
      UNION ALL
      SELECT 'practice_slot'::text, ps.id,
             ps.valid_until, NULL::integer,
             false, ps.valid_until IS NULL
      FROM public.practice_slots ps
      WHERE ps.organization_id = p_organization_id AND ps.field_id = p_field_id
        AND (ps.valid_until IS NULL OR ps.valid_until > p_effective_to)
      UNION ALL
      SELECT 'practice_assignment'::text, pa.id,
             upper(pa.effective_date_range), NULL::integer,
             false,
             pa.effective_date_range IS NULL OR upper_inf(pa.effective_date_range)
      FROM public.practice_assignments pa
      WHERE pa.organization_id = p_organization_id AND pa.field_id = p_field_id
        AND (pa.effective_date_range IS NULL
             OR upper_inf(pa.effective_date_range)
             OR upper(pa.effective_date_range) > p_effective_to)
    )
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'kind', a.kind, 'id', a.id, 'on_date', a.on_date,
            'week_index', a.week_index, 'undated', a.undated, 'unbounded', a.unbounded
          )
          ORDER BY a.on_date NULLS FIRST, a.kind, a.id
        ),
        '[]'::jsonb
      ),
      COUNT(*)
    INTO v_affected, v_affected_count
    FROM affected a;

    -- **The refusal lives here, not in the UI.** A confirmation prompt a
    -- caller can skip by calling the RPC directly is not a guard.
    IF v_affected_count > 0 AND NOT p_confirm THEN
        PERFORM public.record_audit_event(
            p_organization_id,
            'settings.updated',
            'field',
            p_field_id,
            jsonb_build_object(
                'operation', 'admin_retire_field',
                'phase', 'refused',
                'reason', 'bookings_after_effective_to',
                'effective_to', p_effective_to,
                'affected_count', v_affected_count,
                'affected', v_affected,
                'before', to_jsonb(v_before)
            )
        );
        RETURN jsonb_build_object(
            'retired', false,
            'reason', 'bookings_after_effective_to',
            'affected_count', v_affected_count,
            'affected', v_affected
        );
    END IF;

    -- Audit BEFORE the write.
    --
    -- **Not "so it survives a failure of the statement below"** -- that was the
    -- first draft's claim and it is not achievable: this runs in one
    -- transaction, so a failing UPDATE rolls the audit row back with it. What
    -- the before-audit actually buys is ORDERING in the committed trail: the
    -- world the operator decided against is recorded next to the decision, so a
    -- reviewer reading the log sees the state that was changed rather than only
    -- the state that resulted. (The refusal audit above does survive, because
    -- that path RETURNs rather than raising.)
    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'field',
        p_field_id,
        jsonb_build_object(
            'operation', 'admin_retire_field',
            'phase', 'before',
            'effective_to', p_effective_to,
            'confirmed', p_confirm,
            'affected_count', v_affected_count,
            'affected', v_affected,
            'before', to_jsonb(v_before)
        )
    );

    -- **A retirement can only ever REMOVE activity. It never grants it.**
    --
    -- Two drafts got this wrong in opposite directions. The first set
    -- `active = false` unconditionally, so a retirement dated six months out
    -- pulled the field from the scheduler today -- for the very period this
    -- call had just reported unaffected. The second wrote
    -- `active = field_is_live_on(...)`, which is the BICONDITIONAL the header
    -- refuses: retiring an ALREADY-DEACTIVATED field set `active` back to true
    -- and handed it to the scheduler. Retiring something is not a way to
    -- un-deactivate it.
    --
    -- `v_before.active AND live` is the only reading that is one-directional in
    -- the same sense the trigger is: it can turn activity off and never on.
    UPDATE public.fields
    SET effective_to = p_effective_to,
        active = v_before.active AND public.field_is_live_on(p_effective_to),
        updated_at = timezone('utc', now())
    WHERE id = p_field_id AND organization_id = p_organization_id
    RETURNING * INTO v_after;

    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'field',
        p_field_id,
        jsonb_build_object(
            'operation', 'admin_retire_field',
            'phase', 'after',
            'effective_to', p_effective_to,
            'confirmed', p_confirm,
            'affected_count', v_affected_count,
            'after', to_jsonb(v_after)
        )
    );

    RETURN jsonb_build_object(
        'retired', true,
        'affected_count', v_affected_count,
        'affected', v_affected,
        'field', to_jsonb(v_after)
    );
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. admin_unretire_field
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.admin_unretire_field(
    p_organization_id uuid,
    p_field_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before public.fields%ROWTYPE;
    v_after  public.fields%ROWTYPE;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;
    IF p_field_id IS NULL THEN
        RAISE EXCEPTION 'p_field_id is required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_before
    FROM public.fields
    WHERE id = p_field_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Field % not found in organization %', p_field_id, p_organization_id
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM public.record_audit_event(
        p_organization_id, 'settings.updated', 'field', p_field_id,
        jsonb_build_object(
            'operation', 'admin_unretire_field', 'phase', 'before',
            'before', to_jsonb(v_before)
        )
    );

    -- **Unretiring clears the DATE and leaves `active` alone.**
    --
    -- It wrote a constant `true`, which made it not the inverse of retire: a
    -- field an operator had deactivated for its own reasons, then retired, came
    -- back ACTIVE -- the unretire silently discarded a decision it never made.
    -- `v_before` was in hand and unread.
    --
    -- We cannot know whether the inactivity came from the retirement or from an
    -- earlier ordinary deactivation, and inventing an answer is how a fact
    -- nobody recorded gets asserted. So this reverses exactly what it can: the
    -- date. Putting the field back in the scheduler is `admin_update_field`,
    -- which is the existing audited path for that decision.
    UPDATE public.fields
    SET effective_to = NULL,
        active = v_before.active,
        updated_at = timezone('utc', now())
    WHERE id = p_field_id AND organization_id = p_organization_id
    RETURNING * INTO v_after;

    PERFORM public.record_audit_event(
        p_organization_id, 'settings.updated', 'field', p_field_id,
        jsonb_build_object(
            'operation', 'admin_unretire_field', 'phase', 'after',
            'after', to_jsonb(v_after)
        )
    );

    RETURN jsonb_build_object('retired', false, 'field', to_jsonb(v_after));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_retire_field(uuid, uuid, date, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_unretire_field(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_retire_field(uuid, uuid, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unretire_field(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_retire_field(uuid, uuid, date, boolean) IS
  'Org-admin retirement of a field. Refuses with the affected booking list and writes nothing when bookings outlive p_effective_to and p_confirm is false. Writes fields.active and fields.effective_to together. Audits before and after, including the refusal.';
COMMENT ON FUNCTION public.admin_unretire_field(uuid, uuid) IS
  'Org-admin reversal of admin_retire_field. Clears effective_to and leaves fields.active exactly as it was -- it cannot know whether an inactive field was deactivated by the retirement or beforehand, and inventing that answer would discard a decision it never made. Re-activating is admin_update_field. Audits before and after.';

COMMIT;
