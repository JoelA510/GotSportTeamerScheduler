-- Redesign Phase 4 (2/3): audited mutation RPCs for the Players grid.
--
-- Per the project RPC-enforcement rule, the grid never upserts the players
-- table directly. All writes flow through SECURITY DEFINER functions that
-- (a) authorize against org membership, (b) whitelist the patchable
-- columns, (c) validate values, and (d) record audit events.
--
--   * admin_update_player(p_player_id, p_patch)        — single-cell edits
--   * admin_bulk_update_players(p_player_ids, p_patch) — bulk bar actions
--   * admin_create_player(p_organization_id, p_fields) — add-row
--   * admin_delete_players(p_player_ids)               — row/bulk delete
--   * coach_update_player_compliance(p_player_id, p_patch)
--       — compliance booleans only, for coaches on the player's team.

-- ---------------------------------------------------------------------------
-- Shared patch sanitizer: returns only whitelisted, type-validated fields.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sanitize_player_patch(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
    v_out jsonb := '{}'::jsonb;
    v_key text;
    v_val jsonb;
    v_text text;
    v_num numeric;
BEGIN
    IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
        RAISE EXCEPTION 'patch must be a JSON object' USING ERRCODE = '22023';
    END IF;

    FOR v_key, v_val IN SELECT * FROM jsonb_each(p_patch) LOOP
        CASE v_key
            WHEN 'first_name', 'last_name', 'preferred_name', 'gender', 'grade', 'notes',
                 'buddy_request' THEN
                v_text := NULLIF(trim(v_val #>> '{}'), '');
                IF v_key IN ('first_name', 'last_name') AND v_text IS NULL THEN
                    RAISE EXCEPTION '% cannot be empty', v_key USING ERRCODE = '22023';
                END IF;
                v_out := v_out || jsonb_build_object(v_key, to_jsonb(v_text));
            WHEN 'status' THEN
                v_text := lower(trim(v_val #>> '{}'));
                IF v_text NOT IN ('active', 'inactive', 'pending', 'waitlist') THEN
                    RAISE EXCEPTION 'invalid status %', v_text USING ERRCODE = '22023';
                END IF;
                v_out := v_out || jsonb_build_object('status', to_jsonb(v_text));
            WHEN 'rating' THEN
                v_num := CASE WHEN jsonb_typeof(v_val) = 'null' THEN NULL ELSE (v_val #>> '{}')::numeric END;
                IF v_num IS NOT NULL AND (v_num < 1 OR v_num > 5 OR v_num <> round(v_num)) THEN
                    RAISE EXCEPTION 'rating must be an integer 1-5' USING ERRCODE = '22023';
                END IF;
                v_out := v_out || jsonb_build_object('rating', to_jsonb(v_num));
            WHEN 'years_played' THEN
                v_num := CASE WHEN jsonb_typeof(v_val) = 'null' THEN NULL ELSE (v_val #>> '{}')::numeric END;
                IF v_num IS NOT NULL AND (v_num < 0 OR v_num > 30 OR v_num <> round(v_num)) THEN
                    RAISE EXCEPTION 'years_played must be an integer 0-30' USING ERRCODE = '22023';
                END IF;
                v_out := v_out || jsonb_build_object('years_played', to_jsonb(v_num));
            WHEN 'jersey_number' THEN
                v_num := CASE WHEN jsonb_typeof(v_val) = 'null' THEN NULL ELSE (v_val #>> '{}')::numeric END;
                IF v_num IS NOT NULL AND (v_num < 0 OR v_num > 999 OR v_num <> round(v_num)) THEN
                    RAISE EXCEPTION 'jersey_number must be an integer 0-999' USING ERRCODE = '22023';
                END IF;
                v_out := v_out || jsonb_build_object('jersey_number', to_jsonb(v_num));
            WHEN 'paid', 'waiver_received', 'medical_form_received', 'willing_to_coach' THEN
                IF jsonb_typeof(v_val) <> 'boolean' THEN
                    RAISE EXCEPTION '% must be boolean', v_key USING ERRCODE = '22023';
                END IF;
                v_out := v_out || jsonb_build_object(v_key, v_val);
            WHEN 'division_id', 'team_id' THEN
                v_text := NULLIF(trim(v_val #>> '{}'), '');
                IF v_text IS NOT NULL AND v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                    RAISE EXCEPTION '% must be a uuid', v_key USING ERRCODE = '22023';
                END IF;
                v_out := v_out || jsonb_build_object(v_key, to_jsonb(v_text));
            WHEN 'date_of_birth' THEN
                v_text := NULLIF(trim(v_val #>> '{}'), '');
                v_out := v_out || jsonb_build_object('date_of_birth', to_jsonb(v_text));
            WHEN 'guardian_contacts' THEN
                -- Array of {name?, email?, phone?, alternate_email?} objects
                -- (the Player record guardians editor).
                IF jsonb_typeof(v_val) <> 'array' THEN
                    RAISE EXCEPTION 'guardian_contacts must be an array' USING ERRCODE = '22023';
                END IF;
                IF EXISTS (
                    SELECT 1 FROM jsonb_array_elements(v_val) g
                    WHERE jsonb_typeof(g.value) <> 'object'
                       OR EXISTS (
                           SELECT 1 FROM jsonb_object_keys(g.value) k
                           WHERE k NOT IN ('name', 'email', 'phone', 'alternate_email')
                       )
                ) THEN
                    RAISE EXCEPTION 'guardian_contacts entries allow only name/email/phone/alternate_email'
                        USING ERRCODE = '22023';
                END IF;
                IF jsonb_array_length(v_val) > 6 THEN
                    RAISE EXCEPTION 'guardian_contacts limited to 6 entries' USING ERRCODE = '22023';
                END IF;
                v_out := v_out || jsonb_build_object('guardian_contacts', v_val);
            ELSE
                RAISE EXCEPTION 'field % is not editable', v_key USING ERRCODE = '22023';
        END CASE;
    END LOOP;

    IF v_out = '{}'::jsonb THEN
        RAISE EXCEPTION 'patch contains no editable fields' USING ERRCODE = '22023';
    END IF;

    RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Internal applier (not granted): updates one player from a sanitized patch.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.apply_player_patch(p_player_id uuid, p_sanitized jsonb)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    UPDATE public.players p
    SET
        first_name      = COALESCE(CASE WHEN p_sanitized ? 'first_name' THEN p_sanitized->>'first_name' END, p.first_name),
        last_name       = COALESCE(CASE WHEN p_sanitized ? 'last_name' THEN p_sanitized->>'last_name' END, p.last_name),
        preferred_name  = CASE WHEN p_sanitized ? 'preferred_name' THEN p_sanitized->>'preferred_name' ELSE p.preferred_name END,
        gender          = CASE WHEN p_sanitized ? 'gender' THEN p_sanitized->>'gender' ELSE p.gender END,
        grade           = CASE WHEN p_sanitized ? 'grade' THEN p_sanitized->>'grade' ELSE p.grade END,
        notes           = CASE WHEN p_sanitized ? 'notes' THEN p_sanitized->>'notes' ELSE p.notes END,
        buddy_request   = CASE WHEN p_sanitized ? 'buddy_request' THEN p_sanitized->>'buddy_request' ELSE p.buddy_request END,
        status          = CASE WHEN p_sanitized ? 'status' THEN p_sanitized->>'status' ELSE p.status END,
        rating          = CASE WHEN p_sanitized ? 'rating' THEN (p_sanitized->>'rating')::smallint ELSE p.rating END,
        years_played    = CASE WHEN p_sanitized ? 'years_played' THEN (p_sanitized->>'years_played')::smallint ELSE p.years_played END,
        jersey_number   = CASE WHEN p_sanitized ? 'jersey_number' THEN (p_sanitized->>'jersey_number')::smallint ELSE p.jersey_number END,
        paid            = COALESCE(CASE WHEN p_sanitized ? 'paid' THEN (p_sanitized->>'paid')::boolean END, p.paid),
        waiver_received = COALESCE(CASE WHEN p_sanitized ? 'waiver_received' THEN (p_sanitized->>'waiver_received')::boolean END, p.waiver_received),
        medical_form_received = COALESCE(CASE WHEN p_sanitized ? 'medical_form_received' THEN (p_sanitized->>'medical_form_received')::boolean END, p.medical_form_received),
        willing_to_coach = COALESCE(CASE WHEN p_sanitized ? 'willing_to_coach' THEN (p_sanitized->>'willing_to_coach')::boolean END, p.willing_to_coach),
        division_id     = CASE WHEN p_sanitized ? 'division_id' THEN (p_sanitized->>'division_id')::uuid ELSE p.division_id END,
        team_id         = CASE WHEN p_sanitized ? 'team_id' THEN (p_sanitized->>'team_id')::uuid ELSE p.team_id END,
        date_of_birth   = CASE WHEN p_sanitized ? 'date_of_birth' THEN (p_sanitized->>'date_of_birth')::date ELSE p.date_of_birth END,
        guardian_contacts = CASE WHEN p_sanitized ? 'guardian_contacts' THEN p_sanitized->'guardian_contacts' ELSE p.guardian_contacts END,
        updated_at      = timezone('utc', now())
    WHERE p.id = p_player_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_update_player
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_update_player(
    p_player_id uuid,
    p_patch jsonb
)
RETURNS public.players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_player public.players%ROWTYPE;
    v_sanitized jsonb;
BEGIN
    SELECT * INTO v_player FROM public.players WHERE id = p_player_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'player % not found', p_player_id USING ERRCODE = 'P0002';
    END IF;
    IF NOT public.is_org_admin(v_player.organization_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', v_player.organization_id
            USING ERRCODE = '42501';
    END IF;

    v_sanitized := public.sanitize_player_patch(p_patch);

    -- Division/team references must stay inside the player's organization.
    IF v_sanitized ? 'division_id' AND v_sanitized->>'division_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.divisions d
        WHERE d.id = (v_sanitized->>'division_id')::uuid
          AND d.organization_id = v_player.organization_id
    ) THEN
        RAISE EXCEPTION 'division does not belong to organization' USING ERRCODE = '22023';
    END IF;
    IF v_sanitized ? 'team_id' AND v_sanitized->>'team_id' IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.teams t
        WHERE t.id = (v_sanitized->>'team_id')::uuid
          AND t.organization_id = v_player.organization_id
    ) THEN
        RAISE EXCEPTION 'team does not belong to organization' USING ERRCODE = '22023';
    END IF;

    PERFORM public.apply_player_patch(p_player_id, v_sanitized);

    PERFORM public.record_audit_event(
        v_player.organization_id,
        'player.updated',
        'players',
        p_player_id,
        jsonb_build_object('patch', v_sanitized)
    );

    SELECT * INTO v_player FROM public.players WHERE id = p_player_id;
    RETURN v_player;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_bulk_update_players
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_bulk_update_players(
    p_player_ids uuid[],
    p_patch jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
    v_org_count integer;
    v_sanitized jsonb;
    v_id uuid;
    v_count integer := 0;
BEGIN
    IF p_player_ids IS NULL OR array_length(p_player_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'p_player_ids must be a non-empty array' USING ERRCODE = '22023';
    END IF;
    IF array_length(p_player_ids, 1) > 2000 THEN
        RAISE EXCEPTION 'bulk update limited to 2000 players' USING ERRCODE = '22023';
    END IF;

    SELECT count(DISTINCT organization_id), min(organization_id)
    INTO v_org_count, v_org_id
    FROM public.players
    WHERE id = ANY(p_player_ids);

    IF v_org_count <> 1 THEN
        RAISE EXCEPTION 'players must belong to exactly one organization' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_admin(v_org_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', v_org_id
            USING ERRCODE = '42501';
    END IF;

    v_sanitized := public.sanitize_player_patch(p_patch);
    IF v_sanitized ? 'division_id' OR v_sanitized ? 'team_id' OR v_sanitized ? 'first_name'
        OR v_sanitized ? 'last_name' OR v_sanitized ? 'date_of_birth'
        OR v_sanitized ? 'guardian_contacts' THEN
        RAISE EXCEPTION 'field not allowed in bulk updates' USING ERRCODE = '22023';
    END IF;

    FOR v_id IN SELECT unnest(p_player_ids) LOOP
        PERFORM public.apply_player_patch(v_id, v_sanitized);
        v_count := v_count + 1;
    END LOOP;

    PERFORM public.record_audit_event(
        v_org_id,
        'player.bulk_updated',
        'players',
        NULL,
        jsonb_build_object('patch', v_sanitized, 'player_count', v_count)
    );

    RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_create_player
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_create_player(
    p_organization_id uuid,
    p_fields jsonb DEFAULT '{}'::jsonb
)
RETURNS public.players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_player public.players%ROWTYPE;
    v_sanitized jsonb;
BEGIN
    IF NOT public.is_org_admin(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', p_organization_id
            USING ERRCODE = '42501';
    END IF;

    v_sanitized := public.sanitize_player_patch(
        COALESCE(p_fields, '{}'::jsonb)
            || jsonb_build_object(
                'first_name', COALESCE(p_fields->>'first_name', 'New'),
                'last_name', COALESCE(p_fields->>'last_name', 'Player')
            )
    );

    INSERT INTO public.players (organization_id, first_name, last_name, status)
    VALUES (
        p_organization_id,
        v_sanitized->>'first_name',
        v_sanitized->>'last_name',
        COALESCE(v_sanitized->>'status', 'pending')
    )
    RETURNING * INTO v_player;

    PERFORM public.apply_player_patch(v_player.id, v_sanitized);

    PERFORM public.record_audit_event(
        p_organization_id,
        'player.created',
        'players',
        v_player.id,
        jsonb_build_object('fields', v_sanitized)
    );

    SELECT * INTO v_player FROM public.players WHERE id = v_player.id;
    RETURN v_player;
END;
$$;

-- ---------------------------------------------------------------------------
-- admin_delete_players
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_delete_players(p_player_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org_id uuid;
    v_org_count integer;
    v_count integer;
BEGIN
    IF p_player_ids IS NULL OR array_length(p_player_ids, 1) IS NULL THEN
        RAISE EXCEPTION 'p_player_ids must be a non-empty array' USING ERRCODE = '22023';
    END IF;

    SELECT count(DISTINCT organization_id), min(organization_id)
    INTO v_org_count, v_org_id
    FROM public.players
    WHERE id = ANY(p_player_ids);

    IF v_org_count <> 1 THEN
        RAISE EXCEPTION 'players must belong to exactly one organization' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_org_admin(v_org_id) THEN
        RAISE EXCEPTION 'Access denied: admin required for organization %', v_org_id
            USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.team_players tp WHERE tp.player_id = ANY(p_player_ids);
    DELETE FROM public.player_buddies pb
        WHERE pb.player_id = ANY(p_player_ids) OR pb.buddy_player_id = ANY(p_player_ids);
    DELETE FROM public.players WHERE id = ANY(p_player_ids);
    GET DIAGNOSTICS v_count = ROW_COUNT;

    PERFORM public.record_audit_event(
        v_org_id,
        'player.deleted',
        'players',
        NULL,
        jsonb_build_object('player_count', v_count, 'player_ids', to_jsonb(p_player_ids))
    );

    RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- coach_update_player_compliance — compliance booleans only, restricted to
-- coaches whose team the player is on (admins may also call it).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.coach_update_player_compliance(
    p_player_id uuid,
    p_patch jsonb
)
RETURNS public.players
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_player public.players%ROWTYPE;
    v_sanitized jsonb;
    v_key text;
    v_is_team_coach boolean;
BEGIN
    SELECT * INTO v_player FROM public.players WHERE id = p_player_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'player % not found', p_player_id USING ERRCODE = 'P0002';
    END IF;

    v_sanitized := public.sanitize_player_patch(p_patch);
    FOR v_key IN SELECT jsonb_object_keys(v_sanitized) LOOP
        IF v_key NOT IN ('paid', 'waiver_received', 'medical_form_received') THEN
            RAISE EXCEPTION 'field % is not coach-editable', v_key USING ERRCODE = '42501';
        END IF;
    END LOOP;

    IF NOT public.is_org_admin(v_player.organization_id) THEN
        -- The caller must coach the player's team.
        SELECT EXISTS (
            SELECT 1
            FROM public.teams t
            JOIN public.coaches c ON c.id = t.coach_id
            WHERE t.organization_id = v_player.organization_id
              AND (t.id = v_player.team_id OR EXISTS (
                  SELECT 1 FROM public.team_players tp
                  WHERE tp.team_id = t.id AND tp.player_id = v_player.id
              ))
              AND (c.user_id = auth.uid() OR c.profile_id = auth.uid())
        ) INTO v_is_team_coach;

        IF NOT v_is_team_coach THEN
            RAISE EXCEPTION 'Access denied: caller does not coach this player''s team'
                USING ERRCODE = '42501';
        END IF;
    END IF;

    PERFORM public.apply_player_patch(p_player_id, v_sanitized);

    PERFORM public.record_audit_event(
        v_player.organization_id,
        'player.compliance_updated',
        'players',
        p_player_id,
        jsonb_build_object('patch', v_sanitized)
    );

    SELECT * INTO v_player FROM public.players WHERE id = p_player_id;
    RETURN v_player;
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only; anon and PUBLIC revoked (advisor gate).
-- apply_player_patch / sanitize_player_patch are internal helpers.
-- ---------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.sanitize_player_patch(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.apply_player_patch(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_update_player(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_bulk_update_players(uuid[], jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_create_player(uuid, jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_players(uuid[]) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.coach_update_player_compliance(uuid, jsonb) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.admin_update_player(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_bulk_update_players(uuid[], jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_create_player(uuid, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_players(uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.coach_update_player_compliance(uuid, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_update_player(uuid, jsonb) IS
  'Audited single-player patch (whitelisted fields) for org admins; the Players grid''s cell-edit path.';
COMMENT ON FUNCTION public.admin_bulk_update_players(uuid[], jsonb) IS
  'Audited bulk patch (whitelisted scalar fields, single org) for the Players grid bulk bar.';
COMMENT ON FUNCTION public.admin_create_player(uuid, jsonb) IS
  'Audited player creation for the Players grid add-row.';
COMMENT ON FUNCTION public.admin_delete_players(uuid[]) IS
  'Audited player deletion (single org) incl. team_players/player_buddies cleanup.';
COMMENT ON FUNCTION public.coach_update_player_compliance(uuid, jsonb) IS
  'Audited compliance-boolean patch (paid/waiver/medical) for coaches of the player''s team.';
