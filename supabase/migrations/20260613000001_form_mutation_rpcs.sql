-- Registration Forms: audited update + delete RPCs.
--
-- Forms can be created from the UI but had no edit or delete path.
-- These two SECURITY DEFINER functions complete the CRUD surface.

BEGIN;

-- 'registration.form_updated' and 'registration.form_deleted' are new;
-- extend the whitelist (last defined in 20260613000000_coach_delete_rpc.sql).
ALTER TABLE public.audit_log DROP CONSTRAINT IF EXISTS audit_log_action_check;
ALTER TABLE public.audit_log ADD CONSTRAINT audit_log_action_check
    CHECK (action IN (
        'import.started',
        'import.validated',
        'import.canceled',
        'import.completed',
        'import.failed',
        'import.rolled_back',
        'team.saved', 'team.deleted',
        'team.rsvp_updated',
        'team.message_created',
        'game.saved', 'game.deleted',
        'competition.score_updated',
        'practice.saved', 'practice.deleted',
        'registration.form_created',
        'registration.form_updated',
        'registration.form_deleted',
        'registration.submitted', 'registration.approved', 'registration.rejected',
        'compliance.medical_update',
        'calendar.token_rotated',
        'member.invited', 'member.removed', 'member.role_changed',
        'settings.updated',
        'feature_flags.updated',
        'export.started', 'export.completed',
        'organization.onboarded',
        'evaluation.run',
        'scheduler.auto_started',
        'scheduler.auto_progress',
        'scheduler.auto_completed',
        'scheduler.auto_failed',
        'coach.status_updated',
        'coach.promoted',
        'coach.deleted',
        'team.coach_assigned',
        'team.coach_swapped',
        'team.coach_unassigned',
        'player.updated',
        'player.bulk_updated',
        'player.created',
        'player.deleted',
        'player.compliance_updated',
        'teams.auto_balanced',
        'divisions.coed_merged',
        'divisions.gender_split',
        'settings.flags_updated',
        'settings.gender_model_updated',
        'impersonation.started',
        'impersonation.ended',
        'auth.password_updated',
        'settings.season_format_updated',
        'settings.season_updated',
        'settings.timezone_updated'
    ));

-- ---------------------------------------------------------------------------
-- admin_update_registration_form
-- Allows org admins to patch title, description, status, waiver_text, and
-- the custom fields jsonb array.  Null values in the patch are ignored.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_registration_form(
    p_form_id   uuid,
    p_patch     jsonb
)
RETURNS public.registration_forms
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_form public.registration_forms%ROWTYPE;
    v_key  text;
BEGIN
    SELECT * INTO v_form FROM public.registration_forms WHERE id = p_form_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'registration form % not found', p_form_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.is_org_admin(v_form.organization_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', v_form.organization_id
            USING ERRCODE = '42501';
    END IF;
    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
        RAISE EXCEPTION 'patch must be a JSON object' USING ERRCODE = '22023';
    END IF;

    -- Whitelist editable fields.
    FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
        IF v_key NOT IN ('title', 'description', 'status', 'waiver_text', 'fields', 'season_id') THEN
            RAISE EXCEPTION 'field % is not editable on registration_forms', v_key
                USING ERRCODE = '22023';
        END IF;
    END LOOP;

    IF p_patch ? 'title' AND (p_patch->>'title' IS NULL OR trim(p_patch->>'title') = '') THEN
        RAISE EXCEPTION 'title cannot be empty' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'status' AND (p_patch->>'status') NOT IN ('draft', 'open', 'closed') THEN
        RAISE EXCEPTION 'invalid status: %', p_patch->>'status' USING ERRCODE = '22023';
    END IF;
    IF p_patch ? 'fields' AND jsonb_typeof(p_patch->'fields') <> 'array' THEN
        RAISE EXCEPTION 'fields must be a JSON array' USING ERRCODE = '22023';
    END IF;

    UPDATE public.registration_forms
    SET
        title        = CASE WHEN p_patch ? 'title'       THEN trim(p_patch->>'title')         ELSE title       END,
        description  = CASE WHEN p_patch ? 'description' THEN p_patch->>'description'          ELSE description END,
        status       = CASE WHEN p_patch ? 'status'      THEN p_patch->>'status'               ELSE status      END,
        waiver_text  = CASE WHEN p_patch ? 'waiver_text' THEN p_patch->>'waiver_text'           ELSE waiver_text END,
        fields       = CASE WHEN p_patch ? 'fields'      THEN p_patch->'fields'                 ELSE fields      END,
        season_id    = CASE WHEN p_patch ? 'season_id'   THEN (p_patch->>'season_id')::uuid     ELSE season_id   END,
        updated_at   = timezone('utc', now())
    WHERE id = p_form_id;

    PERFORM public.record_audit_event(
        v_form.organization_id,
        'registration.form_updated',
        'registration_forms',
        p_form_id,
        jsonb_build_object('patch_keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p_patch) AS k))
    );

    SELECT * INTO v_form FROM public.registration_forms WHERE id = p_form_id;
    RETURN v_form;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_delete_registration_form
-- Deletes a form and its registrations (FK ON DELETE CASCADE).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_registration_form(p_form_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_form      public.registration_forms%ROWTYPE;
    v_reg_count integer;
BEGIN
    SELECT * INTO v_form FROM public.registration_forms WHERE id = p_form_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'registration form % not found', p_form_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.is_org_admin(v_form.organization_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', v_form.organization_id
            USING ERRCODE = '42501';
    END IF;

    SELECT count(*) INTO v_reg_count
    FROM public.registrations WHERE form_id = p_form_id;

    DELETE FROM public.registration_forms WHERE id = p_form_id;

    PERFORM public.record_audit_event(
        v_form.organization_id,
        'registration.form_deleted',
        'registration_forms',
        p_form_id,
        jsonb_build_object('title', v_form.title, 'registrations_deleted', v_reg_count)
    );

    RETURN v_reg_count + 1;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_update_registration_form(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_registration_form(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_registration_form(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_registration_form(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_update_registration_form(uuid, jsonb) IS
  'Audited registration form patch (title/description/status/waiver_text/fields) for org admins.';
COMMENT ON FUNCTION public.admin_delete_registration_form(uuid) IS
  'Audited registration form deletion (cascades to registrations) for org admins.';

COMMIT;
