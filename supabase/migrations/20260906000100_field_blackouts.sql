-- M2: admin-authored blackouts, and the one reader that answers "is this
-- ground closed on this date" over both blackout tables.
--
-- Phase 8.4 PR 2 of 3.
--
-- ## Two blackout tables survive 8.4, and that is not what "unify" asked for
--
-- The plan was to unify `field_blackout_windows` into one table. Enumerating
-- the family rather than the one RPC named in the plan showed unification is
-- blocked by the data model, not by plumbing:
--
--   * `field_blackout_windows.profile_id` is NOT NULL and points at
--     `field_availability_profiles`, whose own `field_id` is NULLABLE and is
--     resolved by a `LIMIT 1` name match with no NOT FOUND guard
--     (`finalize_field_availability_import_job`). A profile matching no `fields`
--     row still accretes blackouts. Those rows cannot be expressed in a
--     venue/surface-scoped table without either dropping them -- which is the
--     never -- or giving this table a nullable profile_id, which would defeat
--     the unification it exists for.
--   * The shipped read path is a nested PostgREST embed
--     (`field_availability_profiles ( ..., field_blackout_windows ( ... ) )`,
--     `frontend/src/hooks/useFields.js:58`) feeding three UI sites. A table
--     keyed on venue/surface cannot be embedded under profiles.
--
-- So: **disjoint producers, and exactly one reader.**
--
--   1. `field_blackouts` (this file) is the sole producer of admin-authored
--      blackouts -- these RPCs and PR 3's UI.
--   2. `field_blackout_windows` stays owned solely by the import path and is
--      frozen against new writes. Its shipped read path is untouched, which is
--      the whole reason for not repointing it.
--   3. `field_closures` (this file) is the single reader. Any consumer asking
--      whether ground is closed on a date calls it and never touches either
--      table directly, so "when is this ground closed" has one answer rather
--      than two that a caller must remember to union.
--
-- Collapsing the two is a separate task, blocked on the profile->field
-- resolution defect above. It is recorded in the PR body, not fixed here:
-- changing the import path's semantics under a lifecycle migration is how a
-- rider becomes an incident.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. field_blackouts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.field_blackouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Scope. Exactly one of the two is set, enforced below: a blackout closes a
  -- whole site or one piece of ground, never both and never neither.
  location_id uuid REFERENCES public.locations(id) ON DELETE CASCADE,
  field_id uuid REFERENCES public.fields(id) ON DELETE CASCADE,
  -- Inclusive on both ends, matching field_blackout_windows and
  -- field_availability_profiles rather than inventing a third convention.
  blackout_from date NOT NULL,
  blackout_until date NOT NULL,
  -- Minutes past local midnight, nullable for an all-day closure. No timestamp
  -- and no timezone: the corpus is wall clock and two of its dates fall after
  -- DST ends, so an absolute instant would move a boundary by an hour on one
  -- machine and not another (GAP-30).
  start_minutes integer,
  end_minutes integer,
  -- Structured reason, so the free-text note stays a residue rather than the
  -- field an operator types a family's circumstances into (CLAUDE.md section 2,
  -- data minimisation). `note` is guarded by packages/core/src/privacy/.
  reason text NOT NULL DEFAULT 'other'
    CHECK (reason IN ('maintenance','weather','event','permit','closed','other')),
  note text,
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

  CONSTRAINT field_blackouts_scope_check
    CHECK (num_nonnulls(location_id, field_id) = 1),
  CONSTRAINT field_blackouts_date_check
    CHECK (blackout_until >= blackout_from),
  -- Times are both-or-neither, and ordered when present. A half-specified
  -- window is a window nobody can evaluate.
  CONSTRAINT field_blackouts_time_pairing_check
    CHECK (num_nonnulls(start_minutes, end_minutes) IN (0, 2)),
  CONSTRAINT field_blackouts_time_range_check
    CHECK (
      start_minutes IS NULL
      OR (start_minutes BETWEEN 0 AND 1440
          AND end_minutes BETWEEN 0 AND 1440
          AND end_minutes > start_minutes)
    )
);

CREATE INDEX IF NOT EXISTS idx_field_blackouts_field_date
  ON public.field_blackouts (organization_id, field_id, blackout_from, blackout_until);
CREATE INDEX IF NOT EXISTS idx_field_blackouts_location_date
  ON public.field_blackouts (organization_id, location_id, blackout_from, blackout_until);

-- `updated_at` is maintained the way every sibling table maintains it. Without
-- this the column is written once at insert and never again -- a field that
-- reads as "when this last changed" and is not.
DROP TRIGGER IF EXISTS field_blackouts_set_timestamp ON public.field_blackouts;
CREATE TRIGGER field_blackouts_set_timestamp
  BEFORE UPDATE ON public.field_blackouts
  FOR EACH ROW EXECUTE FUNCTION public.trigger_set_timestamp();

COMMENT ON TABLE public.field_blackouts IS
  'Admin-authored closures, scoped to a location or a single field, with optional minutes-past-midnight times. Sole producer of new blackouts. Read through public.field_closures, never directly.';

-- ---------------------------------------------------------------------------
-- 2. The freeze on the old table
-- ---------------------------------------------------------------------------

COMMENT ON TABLE public.field_blackout_windows IS
  'FROZEN as of 20260906000100. Owned solely by finalize_field_availability_import_job; no new code may write it. New blackouts go to public.field_blackouts. Read both through public.field_closures. The two cannot be collapsed until finalize_field_availability_import_job stops attaching blackouts to profiles whose field_id resolution can be NULL -- see the PR body for 8.4 PR 2. tests/fieldBlackoutFreeze.test.js holds the writer set to the import path by scanning the source tree.';

-- ---------------------------------------------------------------------------
-- 3. RLS -- enabled in the same migration that creates the table
-- ---------------------------------------------------------------------------

ALTER TABLE public.field_blackouts ENABLE ROW LEVEL SECURITY;

-- Members read; nobody writes through the table. Writes go through the admin
-- RPCs below, which are SECURITY DEFINER and gate on is_org_admin. There is
-- deliberately no USING (true) anywhere here.
-- **A different name from the one on `field_blackout_windows`.** Both policies
-- were called "Field Blackouts: members select". Legal -- policy names are
-- per-table -- and reader-hostile, because these two tables are precisely the
-- pair a maintainer will confuse: `\dp`, a policy listing, or a grep for the
-- name returns two rows on two tables with one label between them, on exactly
-- the question of which table an admin-authored closure lives in.
DROP POLICY IF EXISTS "Field Blackouts: members select" ON public.field_blackouts;
DROP POLICY IF EXISTS "Admin field blackouts: members select" ON public.field_blackouts;
CREATE POLICY "Admin field blackouts: members select"
  ON public.field_blackouts FOR SELECT
  TO authenticated
  USING (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- 4. field_closures -- the single reader
-- ---------------------------------------------------------------------------
--
-- `security_invoker` so the caller's RLS decides what they see: a view that
-- ran as its owner would hand every org's closures to every member, which is
-- the shape `20260726000000_drop_stale_broad_write_policies.sql` exists to
-- clean up.
--
-- `source` names which table a row came from, so a consumer can tell an
-- admin-authored closure from an import-derived one without joining back.
-- `field_id` is NULLABLE on the import side precisely because the profile it
-- hangs off may resolve to no field -- the defect that blocks unification. It
-- is surfaced rather than filtered out: a closure nobody can attribute to
-- ground is exactly the thing a silent inner join would hide.

DROP VIEW IF EXISTS public.field_closures;
CREATE VIEW public.field_closures
WITH (security_invoker = true) AS
  SELECT
    b.id,
    b.organization_id,
    -- **`closes_location_id` is the SCOPE: the site this closure shuts.**
    -- Renamed from `location_id`, which the first draft filled with the
    -- blackout's scope on this arm and with the FIELD'S location on the other.
    -- One column, two meanings across a union: a location-filtered query
    -- therefore closed every other pitch on the same site. The single reader
    -- asked for one answer and gave a wrong one.
    b.location_id AS closes_location_id,
    b.field_id AS closes_field_id,
    -- The site the closed field happens to sit on. A DIFFERENT fact, so a
    -- different name. Never a scope; present on both arms; NULL when the
    -- closure is site-scoped or the field is unresolved.
    fb.location_id AS field_location_id,
    b.blackout_from,
    b.blackout_until,
    b.start_minutes,
    b.end_minutes,
    b.reason,
    b.note,
    NULL::text AS source_reason_text,
    'field_blackouts'::text AS source
  FROM public.field_blackouts b
  LEFT JOIN public.fields fb ON fb.id = b.field_id
  UNION ALL
  SELECT
    w.id,
    w.organization_id,
    -- **NULL, not the field's location.** An import-derived window hangs off a
    -- profile and closes that profile's ground; it is not site-scoped, and
    -- reporting the field's site here is what made the column mean two things.
    NULL::uuid AS closes_location_id,
    p.field_id AS closes_field_id,
    f.location_id AS field_location_id,
    w.blackout_from,
    w.blackout_until,
    -- NULL times mean all-day on BOTH arms -- an import window is a date range
    -- with no clock, which is all-day. Checked rather than assumed; this pair
    -- is not a second two-meaning column.
    NULL::integer AS start_minutes,
    NULL::integer AS end_minutes,
    -- **NULL, not 'other'.** The import carries no structured reason, and
    -- fabricating one claims a choice nobody made. Its own free text travels
    -- in `note`, where it belongs.
    NULL::text AS reason,
    -- **`note` is admin free text and nothing else.** The first draft put the
    -- import's own `reason` string here, so one column was operator prose on
    -- one arm and the import's reason on the other -- the two-meanings defect
    -- the sweep was supposed to have finished. Worse in combination: with
    -- `reason` NULL on this arm, a consumer filtering the declared enum drops
    -- every import row silently, and PR 1's privacy guard applied to `note`
    -- would erase the import's only statement of why.
    NULL::text AS note,
    -- The import's own words, under their own name, on their own arm.
    w.reason AS source_reason_text,
    'field_blackout_windows'::text AS source
  FROM public.field_blackout_windows w
  JOIN public.field_availability_profiles p ON p.id = w.profile_id
  LEFT JOIN public.fields f ON f.id = p.field_id;

COMMENT ON VIEW public.field_closures IS
  'THE reader for "is this ground closed on this date". Unions admin-authored field_blackouts with import-derived field_blackout_windows so the question has one answer. SCOPE is closes_location_id / closes_field_id -- what this row shuts. field_location_id is a different fact (the site the closed field sits on) and is never a scope; the two were one column in the first draft and a location filter therefore closed every other pitch on the site. closes_field_id is NULL for import rows whose profile resolved to no field -- surfaced, not filtered, because a closure nobody can attribute is what an inner join would hide. reason is NULL on the import arm because the import carries no structured reason, and its own words travel in source_reason_text rather than in note -- note is admin free text on both arms, so a privacy guard or an enum filter cannot silently mean two things. The union is temporary: it collapses to field_blackouts alone once finalize_field_availability_import_job resolves a profile to a field reliably.';

GRANT SELECT ON public.field_closures TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. The admin RPCs -- the only writers of field_blackouts
-- ---------------------------------------------------------------------------
--
-- Audit before AND after, diverging from the four facility RPCs in
-- 20260504060000, which audit the result only. Those four are deliberately not
-- retrofitted; see 20260906000000 for the reasoning.

CREATE OR REPLACE FUNCTION public.admin_create_field_blackout(
    p_organization_id uuid,
    p_location_id uuid,
    p_field_id uuid,
    p_blackout_from date,
    p_blackout_until date,
    p_start_minutes integer DEFAULT NULL,
    p_end_minutes integer DEFAULT NULL,
    p_reason text DEFAULT 'other',
    p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_row public.field_blackouts%ROWTYPE;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;
    -- The scope rule is a CHECK on the table too; stating it here as well gives
    -- the caller a sentence instead of a constraint name.
    IF num_nonnulls(p_location_id, p_field_id) <> 1 THEN
        RAISE EXCEPTION 'exactly one of p_location_id and p_field_id must be set; a blackout closes a site or one piece of ground, never both and never neither'
            USING ERRCODE = '22023';
    END IF;

    -- **Scope must belong to the caller's org.** Without this an admin of one
    -- organization could close another organization's ground, since the RPC is
    -- SECURITY DEFINER and bypasses RLS.
    IF p_location_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.locations
        WHERE id = p_location_id AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'Location % not found in organization %', p_location_id, p_organization_id
            USING ERRCODE = 'P0002';
    END IF;
    IF p_field_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.fields
        WHERE id = p_field_id AND organization_id = p_organization_id
    ) THEN
        RAISE EXCEPTION 'Field % not found in organization %', p_field_id, p_organization_id
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM public.record_audit_event(
        p_organization_id, 'settings.updated', 'field_blackout', NULL,
        jsonb_build_object(
            'operation', 'admin_create_field_blackout', 'phase', 'before',
            'requested', jsonb_build_object(
                'location_id', p_location_id, 'field_id', p_field_id,
                'blackout_from', p_blackout_from, 'blackout_until', p_blackout_until,
                'start_minutes', p_start_minutes, 'end_minutes', p_end_minutes,
                'reason', p_reason
            )
        )
    );

    INSERT INTO public.field_blackouts (
        organization_id, location_id, field_id, blackout_from, blackout_until,
        start_minutes, end_minutes, reason, note, created_by
    ) VALUES (
        p_organization_id, p_location_id, p_field_id, p_blackout_from, p_blackout_until,
        p_start_minutes, p_end_minutes, COALESCE(p_reason, 'other'), p_note, auth.uid()
    )
    RETURNING * INTO v_row;

    PERFORM public.record_audit_event(
        p_organization_id, 'settings.updated', 'field_blackout', v_row.id,
        jsonb_build_object(
            'operation', 'admin_create_field_blackout', 'phase', 'after',
            'after', to_jsonb(v_row)
        )
    );

    RETURN to_jsonb(v_row);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_field_blackout(
    p_organization_id uuid,
    p_blackout_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_before public.field_blackouts%ROWTYPE;
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'p_organization_id is required' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: caller is not an admin of organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;
    IF p_blackout_id IS NULL THEN
        RAISE EXCEPTION 'p_blackout_id is required' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_before
    FROM public.field_blackouts
    WHERE id = p_blackout_id AND organization_id = p_organization_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Blackout % not found in organization %', p_blackout_id, p_organization_id
            USING ERRCODE = 'P0002';
    END IF;

    -- Before, carrying the whole row: after the delete there is nothing left to
    -- describe, so an audit that only ran afterwards would record that
    -- something was removed without recording what.
    PERFORM public.record_audit_event(
        p_organization_id, 'settings.updated', 'field_blackout', p_blackout_id,
        jsonb_build_object(
            'operation', 'admin_delete_field_blackout', 'phase', 'before',
            'before', to_jsonb(v_before)
        )
    );

    DELETE FROM public.field_blackouts
    WHERE id = p_blackout_id AND organization_id = p_organization_id;

    PERFORM public.record_audit_event(
        p_organization_id, 'settings.updated', 'field_blackout', p_blackout_id,
        jsonb_build_object(
            'operation', 'admin_delete_field_blackout', 'phase', 'after',
            'deleted', true
        )
    );

    RETURN jsonb_build_object('deleted', true, 'blackout', to_jsonb(v_before));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_field_blackout(uuid, uuid, uuid, date, date, integer, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_delete_field_blackout(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_create_field_blackout(uuid, uuid, uuid, date, date, integer, integer, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_field_blackout(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_create_field_blackout(uuid, uuid, uuid, date, date, integer, integer, text, text) IS
  'Org-admin creation of an admin-authored blackout. Scope must be exactly one of location or field, and must belong to the caller organization -- checked in the body because a definer-rights function bypasses RLS. Audits before and after.';
COMMENT ON FUNCTION public.admin_delete_field_blackout(uuid, uuid) IS
  'Org-admin deletion of an admin-authored blackout. Audits the whole row before the delete, since afterwards there is nothing left to describe.';

COMMIT;
