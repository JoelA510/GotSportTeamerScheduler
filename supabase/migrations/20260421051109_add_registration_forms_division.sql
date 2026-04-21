-- Fix: registration_forms.division_id was referenced by submit_registration()
-- (in 20260310000003_registrations_rpc.sql + 20260324000003_phase3_registration_rpc_hardening.sql)
-- but never actually added to the registration_forms table by any migration.
--
-- Effect: any call to submit_registration() either errored at function-create
-- time (if check_function_bodies was on) OR errored at runtime ("column
-- rf.division_id does not exist"). The Antigravity audit on 2026-04-21
-- confirmed submit_registration is missing from the live DB — most likely
-- because the original RPC migration silently failed to apply.
--
-- This migration:
--   1. Adds public.registration_forms.division_id (nullable FK to divisions).
--      Nullable because admins may want a single form usable across the org;
--      callers of submit_registration must then provide a division explicitly
--      (the RPC raises a clear error if no division can be resolved).
--   2. Re-creates submit_registration() with the same signature consumers
--      already use AND a defensive guard: if neither the form nor a future
--      caller-supplied path resolves a division_id, the RPC raises with a
--      readable message instead of a NOT NULL violation deep in the players
--      INSERT.
--
-- Reversal: docs/sql/reverts/20260421051109_revert.sql.
-- Smoke:    docs/sql/tests/20260421051109_smoke.sql.
--
-- The other "missing" helper functions Antigravity flagged (handle_field_subunits,
-- propagate_org_id_*, current_user_role, set_created_by_to_auth_uid) ALL
-- exist in repo migrations as `CREATE OR REPLACE FUNCTION` blocks. If they
-- are genuinely missing from the live DB, the operator should re-apply the
-- relevant migrations via `supabase db push` (idempotent for these patterns)
-- — NOT have Antigravity invent new bodies. See the parent PR description.

BEGIN;

-- 1. Add the column. NULL allowed; no default.
ALTER TABLE public.registration_forms
  ADD COLUMN IF NOT EXISTS division_id uuid REFERENCES public.divisions(id) ON DELETE SET NULL;

-- 2. Re-create submit_registration. Restores the Phase 3 hardening from
--    20260324000003 (org derived from form, not trusted from client;
--    caller must be submitting for themselves or be an admin) AND adds the
--    defensive guard when the form has no division. Fixes the regression
--    Gemini flagged in PR #180 review.
CREATE OR REPLACE FUNCTION public.submit_registration(
    p_organization_id uuid,
    p_form_id uuid,
    p_profile_id uuid,
    p_responses jsonb,
    p_player_id uuid DEFAULT NULL,
    p_first_name text DEFAULT NULL,
    p_last_name text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_player_id       uuid := p_player_id;
    v_registration_id uuid;
    v_division_id     uuid;
    v_form_org_id     uuid;
BEGIN
    -- 1. Resolve form → authoritative org_id + division_id. Doing this in a
    --    single SELECT both derives the trusted org context AND establishes
    --    whether the form has a division bound.
    SELECT organization_id, division_id
      INTO v_form_org_id, v_division_id
    FROM public.registration_forms
    WHERE id = p_form_id;

    IF v_form_org_id IS NULL THEN
        RAISE EXCEPTION 'Registration form not found: %', p_form_id
          USING ERRCODE = 'P0002';
    END IF;

    -- 2. Client-provided p_organization_id MUST match the form's real org.
    --    Prevents a user from submitting under Org B's org_id against a
    --    form that actually belongs to Org A.
    IF p_organization_id <> v_form_org_id THEN
        RAISE EXCEPTION 'Organization mismatch: form belongs to a different organization'
          USING ERRCODE = '42501';
    END IF;

    -- 3. Authz: caller must be a member of the form's org.
    IF NOT public.is_org_member(v_form_org_id) THEN
        RAISE EXCEPTION 'Access denied: User is not a member of organization %', v_form_org_id
          USING ERRCODE = '42501';
    END IF;

    -- 4. Caller must be submitting for themselves — unless they are an org
    --    admin, in which case they may submit on behalf of others.
    --    is_org_admin() is SECURITY DEFINER and reads public.organization_members
    --    (the canonical membership table — `organization_roles` referenced by
    --    20260324000001_fix_registration_policies.sql does NOT exist).
    IF p_profile_id <> auth.uid() THEN
        IF NOT public.is_org_admin(v_form_org_id) THEN
            RAISE EXCEPTION 'Access denied: Cannot submit registration for another user'
              USING ERRCODE = '42501';
        END IF;
    END IF;

    -- 5. Create player if not provided. Uses v_form_org_id + the form's
    --    already-resolved v_division_id for data integrity.
    IF v_player_id IS NULL THEN
        IF p_first_name IS NULL OR p_last_name IS NULL THEN
            RAISE EXCEPTION 'New player registration requires first and last name.'
              USING ERRCODE = '22023';
        END IF;

        IF v_division_id IS NULL THEN
            RAISE EXCEPTION 'Cannot register a new player: form % is not bound to a division. Ask an admin to set the form''s division.', p_form_id
              USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.players (organization_id, first_name, last_name, division_id)
        VALUES (v_form_org_id, p_first_name, p_last_name, v_division_id)
        RETURNING id INTO v_player_id;
    END IF;

    -- 6. Ensure player ↔ profile link (scoped by the verified org).
    INSERT INTO public.profile_players (organization_id, profile_id, player_id)
    VALUES (v_form_org_id, p_profile_id, v_player_id)
    ON CONFLICT (profile_id, player_id) DO NOTHING;

    -- 7. Create the registration record (scoped by the verified org).
    INSERT INTO public.registrations (
        organization_id,
        form_id,
        player_id,
        profile_id,
        responses,
        waiver_signed,
        waiver_signed_at
    )
    VALUES (
        v_form_org_id,
        p_form_id,
        v_player_id,
        p_profile_id,
        p_responses,
        true,
        now()
    )
    RETURNING id INTO v_registration_id;

    -- 8. Audit log (Phase 4.6). Best-effort: skip if the helper is absent so
    --    a missing record_audit_event doesn't fail the whole registration.
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'record_audit_event') THEN
        PERFORM public.record_audit_event(
            v_form_org_id,
            'registration.submitted',
            'registration',
            v_registration_id,
            jsonb_build_object('form_id', p_form_id, 'player_id', v_player_id)
        );
    END IF;

    RETURN v_registration_id;
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'This player is already registered for this form.'
          USING ERRCODE = '23505';
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_registration(uuid, uuid, uuid, jsonb, uuid, text, text)
  TO authenticated;

COMMENT ON FUNCTION public.submit_registration(uuid, uuid, uuid, jsonb, uuid, text, text) IS
  'Atomic player+registration creation. Org + division are derived from the form (not trusted from client). Caller must be an org member; admins may submit for others. Writes an audit log entry on success.';

COMMIT;
