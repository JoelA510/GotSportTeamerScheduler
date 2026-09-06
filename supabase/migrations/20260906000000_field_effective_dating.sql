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
-- Two columns saying one thing is a hazard, and the first draft of this
-- migration bounded it wrongly. It claimed the two RPCs below are "the only
-- writers of `active`" and are therefore enough. Enumerating the family rather
-- than the pair shows FOUR pre-existing writers of `fields.active`:
--
--   * 20260503070000_field_import_apply_rollback.sql:518   (import apply)
--   * 20260503070000_field_import_apply_rollback.sql:1088  (import rollback)
--   * 20260504060000_admin_facility_mutation_rpcs.sql:273  (admin_update_field)
--   * and the two RPCs in this file.
--
-- `admin_update_field(p_active => true)` on a retired field would set it active
-- while `effective_to` stayed in the past -- putting formally retired ground
-- back in the scheduler's list. Trusting every writer to remember the pairing
-- is exactly the "one rule, N call sites" shape this phase keeps finding.
--
-- So the invariant is enforced by the DATABASE, once, in a trigger -- not by
-- convention across four RPCs and whatever writes `fields` next.
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

CREATE OR REPLACE FUNCTION public.enforce_field_retirement_deactivates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
    IF NEW.effective_to IS NOT NULL AND NEW.effective_to < current_date THEN
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
  'Holds fields.active and fields.effective_to to their one-directional invariant: a field retired on a past date is never active. Enforced here rather than in each of the four RPCs that write active.';

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

    -- **Every booking a retirement would strand.** Enumerated from the booking
    -- tables, which are what the change corrupts -- not from the field row,
    -- which a retirement leaves intact and which would therefore report
    -- nothing.
    --
    -- TWO tables, not one. `practice_slots.field_id` is NOT NULL REFERENCES
    -- fields with its own valid_from/valid_until, so a retirement strands
    -- practice exactly as it strands games. The first draft enumerated only
    -- game_slots and would have retired a field with live practice on it
    -- reporting `affected_count: 0`.
    --
    -- **A game slot's date is `slot_date`, falling back to `start`.**
    -- `game_slots.start` is nullable AND the import path never populates it --
    -- it writes slot_date/start_time (20260503070000:738). Reading `start`
    -- alone therefore called every import-created slot "undated" and refused
    -- every retirement of an imported field with a warning that was false.
    -- `coalesce(slot_date, start::date)` is the reading
    -- 20260504070000_team_portal_communication_rpcs.sql:138 already uses.
    --
    -- A row that still has no date after the coalesce cannot be judged against
    -- p_effective_to at all. It is carried, flagged `undated`, and counted --
    -- never dropped, because dropping it retires ground out from under a
    -- booking nobody was warned about.
    WITH affected AS (
      SELECT
        'game_slot'::text AS kind,
        gs.id,
        COALESCE(gs.slot_date, gs.start::date) AS on_date,
        gs.week_index::integer AS week_index
      FROM public.game_slots gs
      WHERE gs.organization_id = p_organization_id
        AND gs.field_id = p_field_id
        AND (
          COALESCE(gs.slot_date, gs.start::date) IS NULL
          OR COALESCE(gs.slot_date, gs.start::date) > p_effective_to
        )
      UNION ALL
      SELECT
        'practice_slot'::text AS kind,
        ps.id,
        ps.valid_until AS on_date,
        NULL::integer AS week_index
      FROM public.practice_slots ps
      WHERE ps.organization_id = p_organization_id
        AND ps.field_id = p_field_id
        AND (ps.valid_until IS NULL OR ps.valid_until > p_effective_to)
    )
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'kind', a.kind,
            'id', a.id,
            'on_date', a.on_date,
            'week_index', a.week_index,
            'undated', a.on_date IS NULL
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

    -- **`active` and `effective_to` in one statement.** They cannot disagree
    -- because there is no path that writes one without the other.
    UPDATE public.fields
    SET effective_to = p_effective_to,
        active = false,
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

    UPDATE public.fields
    SET effective_to = NULL,
        active = true,
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
  'Org-admin reversal of admin_retire_field. Clears effective_to and restores active in one statement so the two cannot disagree. Audits before and after.';

COMMIT;
