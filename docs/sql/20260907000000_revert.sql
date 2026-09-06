-- Revert for 20260907000000_field_delete_booking_guard.sql
--
-- Puts back the two-argument, UNGUARDED `admin_delete_field` exactly as
-- 20260504060000_admin_facility_mutation_rpcs.sql shipped it, and drops the
-- foreign key on practice_assignments.field_id.
--
-- **This revert re-opens a live data-integrity defect, and it is not made
-- harmless here.** After it runs:
--
--   * deleting a field CASCADEs its game_slots and practice_slots away,
--     SET NULLs game_assignments.field_id, and leaves
--     practice_assignments.field_id DANGLING again -- with no warning and no
--     list of what was lost;
--   * every practice_assignment currently carrying a field_id loses the only
--     thing that keeps that value pointing at a real row.
--
-- The second of those is silent by nature, so the block below COUNTS the rows
-- that are about to lose their protection before the constraint goes. A count
-- of zero is reported as such rather than passing quietly: if it is zero, this
-- revert is cheap; if it is not, that number is what you are exposing.
--
-- Rows that were repaired to NULL by the forward migration are NOT restored.
-- Their previous values pointed at fields that no longer exist, so there is
-- nothing to restore them to.

BEGIN;

-- What this revert is about to expose, counted while the constraint still exists.
DO $$
DECLARE v_protected integer; v_has_fk boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'practice_assignments_field_id_fkey'
      AND conrelid = 'public.practice_assignments'::regclass
  ) INTO v_has_fk;

  IF NOT v_has_fk THEN
    RAISE NOTICE 'practice_assignments.field_id is already unconstrained; nothing to record';
  ELSE
    SELECT count(*) INTO v_protected
      FROM public.practice_assignments
     WHERE field_id IS NOT NULL;
    IF v_protected > 0 THEN
      RAISE WARNING
        'EXPOSING % practice_assignment(s) with a field_id: after this revert a field delete leaves them dangling',
        v_protected;
    ELSE
      RAISE NOTICE
        'no practice_assignments currently carry a field_id; this revert exposes no existing row';
    END IF;
  END IF;
END $$;

ALTER TABLE public.practice_assignments
  DROP CONSTRAINT IF EXISTS practice_assignments_field_id_fkey;

COMMENT ON COLUMN public.practice_assignments.field_id IS NULL;

DROP FUNCTION IF EXISTS public.admin_delete_field(uuid, uuid, boolean);

-- Restored verbatim from 20260504060000_admin_facility_mutation_rpcs.sql.
CREATE OR REPLACE FUNCTION public.admin_delete_field(
    p_organization_id uuid,
    p_field_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_existing public.fields%ROWTYPE;
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

    DELETE FROM public.fields
     WHERE id = p_field_id
       AND organization_id = p_organization_id
    RETURNING * INTO v_existing;

    IF v_existing.id IS NULL THEN
        RAISE EXCEPTION 'field % was not found in organization %', p_field_id, p_organization_id
            USING ERRCODE = 'P0002';
    END IF;

    PERFORM public.record_audit_event(
        p_organization_id,
        'settings.updated',
        'field',
        v_existing.id,
        jsonb_build_object(
            'setting', 'facility.field',
            'operation', 'deleted',
            'previous', to_jsonb(v_existing)
        )
    );

    RETURN jsonb_build_object(
        'id', v_existing.id,
        'organization_id', v_existing.organization_id,
        'deleted', true
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_field(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_delete_field(uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.admin_delete_field(uuid, uuid) IS
  'Admin-only org-scoped field deletion with settings.updated audit logging.';

COMMIT;
