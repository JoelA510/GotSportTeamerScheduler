-- Consolidated RLS / RPC security hardening.
--
-- Closes live authorization gaps that prior Codex PRs (#284-#290, #293) aimed
-- at but did not actually fix: those either edited already-applied (immutable)
-- migrations or dropped policy names that do not match the live database, so the
-- permissive member-write policies survived. This migration targets the ACTUAL
-- live policy/function names verified against the running project.
--
-- Why this is safe: all org-scoped domain-state persistence goes through
-- SECURITY DEFINER RPCs and service-role Edge Functions, both of which bypass
-- RLS. The SPA never writes these tables directly from the client (verified:
-- only reads). The permissive member-write policies were pure attack surface.

-- 1. Member-read / admin-write split on org-scoped domain tables -------------
--    Live state: each table below is guarded by a single permissive ALL policy
--    named either "org_member_access" or "Enforce Org Membership: ALL" using
--    is_org_member(). Replace it with member-read + admin-write.
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'email_log','export_jobs','field_subunits','game_slots','games',
    'player_buddies','practice_assignments','practice_slots','staging_players','team_players',
    'players','evaluation_runs','evaluation_findings','evaluation_metrics','evaluation_run_events'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    -- Remove whichever permissive ALL policy currently guards the table.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'org_member_access', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', 'Enforce Org Membership: ALL', t);
    -- Idempotent re-create of the split policies.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_select_member', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_write_admin', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated '
      'USING (public.is_org_member(organization_id))',
      t || '_select_member', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.is_org_admin(organization_id)) '
      'WITH CHECK (public.is_org_admin(organization_id))',
      t || '_write_admin', t);
  END LOOP;
END$$;

-- 2. Harden submit_registration --------------------------------------------
--    Bind the caller to auth.uid(); require the form to be open and in-org;
--    require existing players to belong to the org and already be linked to the
--    caller. The registration UI only offers already-linked players, so
--    legitimate flows are unaffected -- this only blocks forged player IDs.
CREATE OR REPLACE FUNCTION public.submit_registration(
  p_organization_id uuid,
  p_form_id uuid,
  p_profile_id uuid,
  p_responses jsonb,
  p_player_id uuid DEFAULT NULL::uuid,
  p_first_name text DEFAULT NULL::text,
  p_last_name text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_caller          uuid := auth.uid();
    v_player_id       uuid := p_player_id;
    v_registration_id uuid;
    v_division_id     uuid;
BEGIN
    -- Caller may only submit on their own behalf.
    IF v_caller IS NULL OR p_profile_id <> v_caller THEN
        RAISE EXCEPTION 'Access denied: profile mismatch.'
          USING ERRCODE = '42501';
    END IF;

    IF NOT public.is_org_member(p_organization_id) THEN
        RAISE EXCEPTION 'Access denied: User is not a member of organization %', p_organization_id
          USING ERRCODE = '42501';
    END IF;

    -- Form must belong to the org and be open.
    SELECT rf.division_id INTO v_division_id
    FROM public.registration_forms rf
    WHERE rf.id = p_form_id
      AND rf.organization_id = p_organization_id
      AND rf.status = 'open';

    IF v_division_id IS NULL THEN
        RAISE EXCEPTION 'Invalid or closed registration form for organization %', p_organization_id
          USING ERRCODE = '22023';
    END IF;

    IF v_player_id IS NULL THEN
        IF p_first_name IS NULL OR p_last_name IS NULL THEN
            RAISE EXCEPTION 'New player registration requires first and last name.'
              USING ERRCODE = '22023';
        END IF;

        INSERT INTO public.players (organization_id, first_name, last_name, division_id)
        VALUES (p_organization_id, p_first_name, p_last_name, v_division_id)
        RETURNING id INTO v_player_id;
    ELSE
        -- Existing player must belong to the org and already be linked to the caller.
        IF NOT EXISTS (
            SELECT 1 FROM public.players p
            WHERE p.id = v_player_id AND p.organization_id = p_organization_id
        ) THEN
            RAISE EXCEPTION 'Invalid player for organization %', p_organization_id
              USING ERRCODE = '42501';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.profile_players pp
            WHERE pp.profile_id = v_caller
              AND pp.player_id = v_player_id
              AND pp.organization_id = p_organization_id
        ) THEN
            RAISE EXCEPTION 'Access denied: player is not linked to caller profile.'
              USING ERRCODE = '42501';
        END IF;
    END IF;

    INSERT INTO public.profile_players (organization_id, profile_id, player_id)
    VALUES (p_organization_id, p_profile_id, v_player_id)
    ON CONFLICT (profile_id, player_id) DO NOTHING;

    INSERT INTO public.registrations (
        organization_id, form_id, player_id, profile_id, responses, waiver_signed, waiver_signed_at
    )
    VALUES (
        p_organization_id, p_form_id, v_player_id, p_profile_id, p_responses, true, now()
    )
    RETURNING id INTO v_registration_id;

    RETURN v_registration_id;
EXCEPTION
    WHEN unique_violation THEN
        RAISE EXCEPTION 'This player is already registered for this form.'
          USING ERRCODE = '23505';
END;
$function$;

-- 3. Require org admin for the coach-lead import summary RPC -----------------
CREATE OR REPLACE FUNCTION public.set_import_job_coach_lead_summary(
  p_import_job_id uuid,
  p_summary jsonb,
  p_status text DEFAULT NULL::text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_org_id uuid;
BEGIN
    IF p_summary IS NULL OR jsonb_typeof(p_summary) <> 'object' THEN
        RAISE EXCEPTION 'p_summary must be a jsonb object';
    END IF;

    IF p_status IS NOT NULL
       AND p_status NOT IN (
           'queued','processing','importing','completed',
           'completed_with_warnings','needs_fix','failed'
       ) THEN
        RAISE EXCEPTION 'invalid import job status: %', p_status
            USING ERRCODE = '23514';
    END IF;

    SELECT organization_id INTO v_org_id
    FROM public.import_jobs
    WHERE id = p_import_job_id;

    IF v_org_id IS NULL THEN
        RAISE EXCEPTION 'Import job not found: %', p_import_job_id
            USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_org_admin(v_org_id) THEN
        RAISE EXCEPTION 'Access denied: user is not an admin of organization %', v_org_id
            USING ERRCODE = '42501';
    END IF;

    UPDATE public.import_jobs
    SET
        status = COALESCE(p_status, status),
        warning_summary = jsonb_set(
            COALESCE(warning_summary, '{}'::jsonb),
            '{coach_leads}',
            p_summary,
            true
        )
    WHERE id = p_import_job_id;
END;
$function$;

-- 4. Tighten registrations RLS: self branch requires org membership + WITH CHECK
--    Prevents cross-tenant inserts/updates by spoofing profile_id = auth.uid()
--    with an arbitrary organization_id.
DROP POLICY IF EXISTS "registrations_user_own_or_admin" ON public.registrations;
CREATE POLICY "registrations_user_own_or_admin"
    ON public.registrations FOR ALL TO authenticated
    USING (
        (profile_id = auth.uid() AND public.is_org_member(organization_id))
        OR (
            public.is_org_member(organization_id) AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.profile_id = auth.uid()
                  AND om.organization_id = registrations.organization_id
                  AND om.role = 'admin'
            )
        )
    )
    WITH CHECK (
        (profile_id = auth.uid() AND public.is_org_member(organization_id))
        OR (
            public.is_org_member(organization_id) AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.profile_id = auth.uid()
                  AND om.organization_id = registrations.organization_id
                  AND om.role = 'admin'
            )
        )
    );

-- 5. Remove end-user DELETE on the raw-imports storage bucket ----------------
--    Retention cleanup runs via service-role automation, which bypasses RLS.
DROP POLICY IF EXISTS "raw-imports org-member delete" ON storage.objects;
