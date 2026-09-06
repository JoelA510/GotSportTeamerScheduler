-- LIVE-1: give admin_delete_field the booking guard it never had, and give
-- practice_assignments.field_id the foreign key it never had.
--
-- Recorded as LIVE-1 at the foot of docs/PHASE_8_PROGRESS.md after 8.4 PR 2.
-- Its own PR, not part of the 8.4 three-PR stack.
--
-- ## The defect
--
-- `admin_delete_field` (20260504060000_admin_facility_mutation_rpcs.sql:296)
-- runs `DELETE FROM public.fields` behind an `is_org_admin` gate and a
-- not-found check and NOTHING else. One admin action loses schedule data three
-- different ways, silently, and the three are different from each other:
--
--   * `game_slots.field_id` and `practice_slots.field_id` are NOT NULL FKs
--     `ON DELETE CASCADE`, so the slots are DELETED with the field.
--   * `game_assignments.field_id` is `ON DELETE SET NULL` (added by
--     20260503030000_repair_game_persistence_rpc.sql), so a scheduled game
--     SURVIVES having silently lost its venue.
--   * `practice_assignments.field_id` had NO FOREIGN KEY AT ALL -- a bare
--     `uuid` column since 20260331000000_definitive_schema.sql -- so the value
--     was left DANGLING at a row that no longer exists. Worse than the SET NULL
--     case: the column still reads as set, so nothing downstream can tell
--     "assigned to this pitch" from "assigned to a pitch that was deleted".
--
-- All three were verified against the applied schema before this file was
-- written, by querying `pg_constraint` on a database with every migration
-- applied, rather than by grepping the migrations -- a grep for
-- `field_id ... ON DELETE CASCADE` returns `field_subunits`, `practice_slots`
-- and `game_slots`, none of which is an assignment table, and reading that as
-- confirmation of the assignment-table claims would have confirmed the wrong
-- thing.
--
-- ## The contract, taken from the sibling rather than invented
--
-- `admin_retire_field` (20260906000000) already answers "what happens when you
-- remove ground that is booked": with `p_confirm = false` and at least one
-- affected booking it RETURNS `{retired: false, reason, affected_count,
-- affected}` -- no exception -- writes a `phase: 'refused'` audit row, and
-- changes no field state. A third answer to the same question is the defect
-- class this phase keeps finding, so this adopts that shape exactly:
-- `{deleted: false, reason: 'bookings_exist', affected_count, affected}`, a
-- refused audit row, and no DELETE.
--
-- Two details of that contract are worth stating because a reading of the
-- sibling that was not executed got both backwards: it RETURNS rather than
-- RAISES, and it DOES write (the refusal audit row). A caller that only checks
-- PostgREST's `error` sees a refusal as success -- which is exactly what
-- `frontend/src/hooks/useFields.js` did before this PR, discarding `data`
-- entirely and then removing the field from the list it had not deleted.
--
-- The reason literal differs because the question does: a retirement has a
-- date and asks "what is booked AFTER it", so its reason is
-- `bookings_after_effective_to`. A deletion has no date and takes everything,
-- so its reason is `bookings_exist` and its enumeration has no date filter.
--
-- `admin_delete_field` KEEPS EXISTING. The UI surfaces Retire, but a genuine
-- mistake -- a field created twice, a typo -- still needs a delete, and
-- `p_confirm => true` is that path.
--
-- ## The family, derived from the REFERENTIAL GRAPH rather than a column name
--
-- The first version of this header enumerated the seven tables that carry a
-- `field_id` and called that the family. It is not the family: what a delete
-- destroys is the CASCADE CLOSURE from `fields`, and that closure was computed
-- from `pg_constraint` only after a review asked. It has fifteen edges over
-- three levels, and two of the things it reaches were invisible to a
-- column-name census:
--
--   * `games` -- no `field_id` at all. It hangs off `game_slots` ON DELETE
--     CASCADE (20260331000000:585), so deleting the ground destroys the
--     fixture AND the recorded score. A column-name census cannot see it.
--   * `game_assignments` and `practice_assignments` reach the field a SECOND
--     way, through their slot columns, and those edges are CASCADE where the
--     `field_id` edge is SET NULL. The CASCADE wins: an assignment produced by
--     the scheduler is destroyed, not unassigned. Both halves of that were
--     measured against a real delete before this was written.
--
-- FIVE kinds are read as bookings: game_slot, game (via its slot),
-- game_assignment, practice_slot, practice_assignment -- the last two of which
-- report their disposition PER ROW, because it depends on whether that row has
-- a slot behind it.
--
-- Three tables in the closure are excluded, each for a stated reason:
--   * field_subunits              CASCADE. The estate's own structure: a
--     subunit is part of the field, not a use of it. A practice slot scoped to
--     a HALF pitch still carries the parent's field_id (NOT NULL), so it is
--     caught by the practice_slots arm.
--   * field_availability_profiles SET NULL. Import metadata describing the
--     ground, not a use of it, and nothing is destroyed. (Its nullable
--     field_id is the subject of LIVE-2 and is not touched here.)
--   * field_blackouts             CASCADE. A closure, not a booking: deleting
--     a field cannot strand the statement that it was already shut.
--
-- `docs/sql/20260907000000_smoke.sql` re-derives the closure on every harness
-- run and fails if a table joins or leaves it, so the next `games` cannot
-- arrive unnoticed.
--
-- ## Why practice_assignments.field_id becomes ON DELETE SET NULL
--
-- Its twin `game_assignments.field_id` is already SET NULL, and the two
-- currently DISAGREE only because one of them has no constraint at all. This
-- makes them AGREE, deliberately, and the alternatives were considered rather
-- than skipped:
--
--   * CASCADE would delete the assignment row -- the persisted schedule entry
--     naming a team, a day and a time. The field is one attribute of that row;
--     destroying the whole booking to remove one attribute loses more than the
--     operator asked to lose, and it would also make the two assignment tables
--     disagree in the other direction.
--   * RESTRICT / NO ACTION would make the delete impossible even with
--     `p_confirm => true`, which contradicts keeping a genuine mistake
--     deletable. The refusal belongs in the RPC, where it can be confirmed,
--     not in a constraint that cannot.
--   * SET NULL leaves the assignment intact and its venue VISIBLY absent,
--     which is the state a downstream reader can surface as TBD. A dangling
--     uuid cannot be surfaced as anything, because nothing can tell it from a
--     live one.
--
-- Rows already dangling are repaired to NULL below, loudly: the count is
-- printed, and a repair that touched nothing says so rather than passing in
-- silence.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. practice_assignments.field_id: repair, then constrain
-- ---------------------------------------------------------------------------

-- **The cleanup is enumerated from practice_assignments, not from fields.**
-- The rows at issue are precisely the ones whose field is already gone, so
-- deriving them from `fields` -- the data the break corrupted -- would find
-- none of them. `NOT EXISTS` against `fields` is the reading that survives.
DO $$
DECLARE v_repaired integer;
BEGIN
    IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'practice_assignments_field_id_fkey'
          AND conrelid = 'public.practice_assignments'::regclass
    ) THEN
        RAISE NOTICE 'practice_assignments.field_id already constrained; no repair needed';
        RETURN;
    END IF;

    UPDATE public.practice_assignments pa
       SET field_id = NULL,
           updated_at = timezone('utc', now())
     WHERE pa.field_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.fields f WHERE f.id = pa.field_id);
    GET DIAGNOSTICS v_repaired = ROW_COUNT;

    IF v_repaired > 0 THEN
        -- WARNING, not NOTICE: these are practices whose venue was lost by an
        -- earlier unguarded delete, and the operator should know how many.
        RAISE WARNING
          'repaired % practice_assignment(s) whose field_id pointed at a deleted field', v_repaired;
    ELSE
        RAISE NOTICE 'no dangling practice_assignments.field_id values to repair';
    END IF;
END $$;

ALTER TABLE public.practice_assignments
  DROP CONSTRAINT IF EXISTS practice_assignments_field_id_fkey;

ALTER TABLE public.practice_assignments
  ADD CONSTRAINT practice_assignments_field_id_fkey
  FOREIGN KEY (field_id) REFERENCES public.fields (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.practice_assignments.field_id IS
  'The pitch this practice is assigned to. ON DELETE SET NULL, matching game_assignments.field_id: deleting a field must not destroy the booking, and must not leave a uuid pointing at nothing either. NULL here means the venue is gone and the practice needs one.';

-- ---------------------------------------------------------------------------
-- 2. admin_delete_field, with the refusal shape admin_retire_field already has
-- ---------------------------------------------------------------------------
--
-- **The two-argument function is DROPPED, not left beside the new one.**
-- Adding `p_confirm boolean DEFAULT false` creates an OVERLOAD that no
-- two-argument call can resolve. Measured rather than reasoned about, because
-- the first draft of this comment got the consequence backwards: with both
-- signatures present, BOTH a named call and a positional one raise
-- `42725 function ... is not unique`. So the hazard is not "a caller quietly
-- reaches the unguarded body" -- it is that every existing two-argument caller
-- (`useFields.deleteField`, `supabase/tests/facility_admin_rpcs.sql`) stops
-- working at all, and the fix someone reaches for under that pressure is to
-- call the old signature explicitly, which IS the unguarded body. Dropping it
-- removes both outcomes.
DROP FUNCTION IF EXISTS public.admin_delete_field(uuid, uuid);

CREATE OR REPLACE FUNCTION public.admin_delete_field(
    p_organization_id uuid,
    p_field_id uuid,
    p_confirm boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing public.fields%ROWTYPE;
    v_affected jsonb;
    v_affected_count integer;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required'
            USING ERRCODE = '23502';
    END IF;

    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    IF p_field_id IS NULL THEN
        RAISE EXCEPTION 'p_field_id is required'
            USING ERRCODE = '23502';
    END IF;

    -- **Locked and read BEFORE the delete, not returned by it.** The original
    -- deleted first and inferred not-found from the RETURNING being empty, so
    -- there was no window in which the field existed and the bookings could be
    -- counted.
    --
    -- `FOR UPDATE` also closes the gap between counting and deleting, and it
    -- does so through the foreign keys rather than despite them: inserting a
    -- row that REFERENCES this field takes a KEY SHARE lock on it, which
    -- conflicts with the FOR UPDATE held here. That covers a booking table
    -- only if it HAS such a key -- which practice_assignments did not until
    -- the constraint added above, so the same defect closed two things.
    SELECT *
      INTO v_existing
      FROM public.fields
     WHERE id = p_field_id
       AND organization_id = p_organization_id
     FOR UPDATE;

    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'field % was not found in organization %', p_field_id, p_organization_id
            USING ERRCODE = 'P0002';
    END IF;

    -- **Every booking the deletion would take -- all FOUR tables**, and what
    -- it would do to each. Enumerated from the BOOKING tables, never from the
    -- field: the field is the row about to disappear, so anything derived from
    -- it would report an empty set exactly when the answer matters.
    --
    -- No date filter, unlike admin_retire_field: a deletion has no effective
    -- date and takes everything on the ground, dated or not.
    --
    -- `disposition` says what the schema will do, and the per-kind literals
    -- below are checked against `pg_constraint.confdeltype` by
    -- docs/sql/20260907000000_smoke.sql rather than trusted -- if an ON DELETE
    -- rule is ever changed without changing this list, the smoke goes red.
    --   'deleted'    -- the FK is ON DELETE CASCADE; the row goes with the field
    --   'unassigned' -- the FK is ON DELETE SET NULL; the row survives, venueless
    --
    -- `undated` means the row records no date at all, so the operator cannot
    -- see WHEN the thing they are about to lose was. `unbounded` means it runs
    -- forever. Neither changes that it is affected -- for a deletion,
    -- everything on the field is -- they say what is being lost.
    WITH affected AS (
      SELECT 'game_slot'::text AS kind, gs.id,
             COALESCE(gs.slot_date, gs.start::date) AS on_date,
             gs.week_index::integer AS week_index,
             COALESCE(gs.slot_date, gs.start::date) IS NULL AS undated,
             false AS unbounded,
             'deleted'::text AS disposition
      FROM public.game_slots gs
      WHERE gs.organization_id = p_organization_id AND gs.field_id = p_field_id
      UNION ALL
      -- **`games` carries no field_id and is destroyed anyway.** It hangs off
      -- game_slots ON DELETE CASCADE (20260331000000:585), so deleting the
      -- ground takes the fixture and the score with it. Enumerating the family
      -- by COLUMN NAME missed it entirely -- the first version of this RPC
      -- reported nothing about the one table that holds a result.
      SELECT 'game'::text, g.id,
             COALESCE(gs.slot_date, gs.start::date), gs.week_index::integer,
             COALESCE(gs.slot_date, gs.start::date) IS NULL, false,
             'deleted'::text
      FROM public.games g
      JOIN public.game_slots gs ON gs.id = g.game_slot_id
      WHERE gs.organization_id = p_organization_id AND gs.field_id = p_field_id
      UNION ALL
      -- **An assignment's fate depends on the ROW, not on its table.**
      -- `game_assignments.field_id` is SET NULL, so the first version of this
      -- RPC told the operator every assignment would survive venueless. That is
      -- true only of an assignment with no slot behind it. `persist_game_schedule`
      -- writes `game_slot_id` and `slot_id` on every row it produces
      -- (20260503030000:618-630), and both are ON DELETE CASCADE to `game_slots`
      -- -- so for a real persisted schedule the slot cascade destroys the
      -- assignment before the SET NULL can fire. Measured, not reasoned about:
      -- an assignment carrying `game_slot_id` does not survive the delete.
      --
      -- The row is also caught when its SLOT is on this ground but its own
      -- `field_id` is not, because the cascade does not consult `field_id`.
      SELECT 'game_assignment'::text, ga.id,
             ga.start::date, ga.week_index::integer,
             ga.start IS NULL, false,
             CASE WHEN EXISTS (
                    SELECT 1 FROM public.game_slots s
                     WHERE s.field_id = p_field_id
                       AND s.id IN (ga.game_slot_id, ga.slot_id)
                  ) THEN 'deleted' ELSE 'unassigned' END
      FROM public.game_assignments ga
      WHERE ga.organization_id = p_organization_id
        AND (ga.field_id = p_field_id
             OR EXISTS (SELECT 1 FROM public.game_slots s
                         WHERE s.field_id = p_field_id
                           AND s.id IN (ga.game_slot_id, ga.slot_id)))
      UNION ALL
      SELECT 'practice_slot'::text, ps.id,
             ps.valid_until, NULL::integer,
             false, ps.valid_until IS NULL, 'deleted'::text
      FROM public.practice_slots ps
      WHERE ps.organization_id = p_organization_id AND ps.field_id = p_field_id
      UNION ALL
      -- The same, for practices. `practice_assignments.slot_id` and
      -- `.practice_slot_id` are both ON DELETE CASCADE to `practice_slots`
      -- (20260331000000:526-527) and `persist_practice_schedule` writes them.
      SELECT 'practice_assignment'::text, pa.id,
             upper(pa.effective_date_range), NULL::integer,
             false,
             pa.effective_date_range IS NULL OR upper_inf(pa.effective_date_range),
             CASE WHEN EXISTS (
                    SELECT 1 FROM public.practice_slots s
                     WHERE s.field_id = p_field_id
                       AND s.id IN (pa.practice_slot_id, pa.slot_id)
                  ) THEN 'deleted' ELSE 'unassigned' END
      FROM public.practice_assignments pa
      WHERE pa.organization_id = p_organization_id
        AND (pa.field_id = p_field_id
             OR EXISTS (SELECT 1 FROM public.practice_slots s
                         WHERE s.field_id = p_field_id
                           AND s.id IN (pa.practice_slot_id, pa.slot_id)))
    )
    SELECT
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'kind', a.kind, 'id', a.id, 'on_date', a.on_date,
            'week_index', a.week_index, 'undated', a.undated,
            'unbounded', a.unbounded, 'disposition', a.disposition
          )
          ORDER BY a.on_date NULLS FIRST, a.kind, a.id
        ),
        '[]'::jsonb
      ),
      COUNT(*)
    INTO v_affected, v_affected_count
    FROM affected a;

    -- **The refusal lives here, not in the UI.** A confirmation prompt a
    -- caller can skip by calling the RPC directly is not a guard. Same shape as
    -- admin_retire_field: RETURN, do not RAISE, and record the refusal.
    IF v_affected_count > 0 AND NOT COALESCE(p_confirm, false) THEN
        PERFORM public.record_audit_event(
            p_organization_id,
            'settings.updated',
            'field',
            p_field_id,
            jsonb_build_object(
                'setting', 'facility.field',
                'operation', 'admin_delete_field',
                'phase', 'refused',
                'reason', 'bookings_exist',
                'affected_count', v_affected_count,
                'affected', v_affected,
                'previous', to_jsonb(v_existing)
            )
        );
        RETURN jsonb_build_object(
            'deleted', false,
            'reason', 'bookings_exist',
            'affected_count', v_affected_count,
            'affected', v_affected
        );
    END IF;

    -- Audit BEFORE the delete, so the world the operator decided against is in
    -- the trail next to the decision. This runs in one transaction, so it does
    -- NOT survive a failure of the DELETE below -- the refusal above does,
    -- because that path RETURNs.
    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'field',
        p_field_id,
        jsonb_build_object(
            'setting', 'facility.field',
            'operation', 'admin_delete_field',
            'phase', 'before',
            'confirmed', COALESCE(p_confirm, false),
            'affected_count', v_affected_count,
            'affected', v_affected,
            'previous', to_jsonb(v_existing)
        )
    );

    DELETE FROM public.fields
     WHERE id = p_field_id
       AND organization_id = p_organization_id;

    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'field',
        v_existing.id,
        jsonb_build_object(
            'setting', 'facility.field',
            'operation', 'admin_delete_field',
            'phase', 'after',
            'confirmed', COALESCE(p_confirm, false),
            'affected_count', v_affected_count,
            'deleted', true,
            'previous', to_jsonb(v_existing)
        )
    );

    RETURN jsonb_build_object(
        'id', v_existing.id,
        'organization_id', v_existing.organization_id,
        'deleted', true,
        'affected_count', v_affected_count,
        'affected', v_affected
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_field(uuid, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_field(uuid, uuid, boolean) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_field(uuid, uuid, boolean) IS
  'Admin-only org-scoped field deletion. Refuses with everything the delete would take -- game_slots, games, game_assignments, practice_slots, practice_assignments -- unless p_confirm is true, mirroring admin_retire_field. Each affected row carries a disposition: deleted (a CASCADE reaches it) or unassigned (only its field_id is SET NULL); assignments report this per row, because a slot-linked assignment is destroyed while a free-standing one survives. Returns {deleted:false, reason:''bookings_exist'', affected_count, affected} on refusal rather than raising, and audits refused/before/after.';

COMMIT;
