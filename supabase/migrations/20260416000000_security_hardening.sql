-- ==================================================================================
-- SECURITY HARDENING: ORG-SCOPED RLS & REGISTRATION POLICY FIX
-- ==================================================================================
-- This migration addresses Tasks 2 and 3 of the Production Readiness Plan:
-- 1. Ensures organization_id exists on all org-scoped tables.
-- 2. Implements strict USING (is_org_member(organization_id)) policies.
-- 3. Fixes registration policies to correctly reference organization_members.
-- ==================================================================================

BEGIN;

-- 1. ENSURE organization_id COLUMNS EXIST (Safety check for flagged tables)
DO $$
DECLARE
    v_table_name text;
BEGIN
    -- List of tables to check/harden
    -- Note: Many were already added in definitive_schema, but we ensure consistency here.
    -- If tables like evaluation_criteria don't exist, we skip them silently to avoid failure.
    
    PERFORM 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'field_subunits';
    IF FOUND THEN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'field_subunits' AND column_name = 'organization_id') THEN
            ALTER TABLE public.field_subunits ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE;
        END IF;
    END IF;

    -- Repeat for other "flagged" tables
    FOR v_table_name IN SELECT unnest(ARRAY[
        'field_subunits', 'practice_slots', 'game_slots', 'team_players', 
        'practice_assignments', 'games', 'staging_players', 'player_buddies', 
        'scheduler_runs', 'evaluation_criteria', 'evaluation_scores', 
        'evaluation_sessions', 'export_jobs', 'email_log'
    ]) LOOP
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = v_table_name) THEN
            IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = v_table_name AND column_name = 'organization_id') THEN
                EXECUTE format('ALTER TABLE public.%I ADD COLUMN organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE', v_table_name);
            END IF;
        END IF;
    END LOOP;
END$$;

-- 2. HARDEN RLS POLICIES (Drop legacy admin policies and apply org-scoped access)
-- Strategy: For each table, drop all existing policies and create a clean "org_member_access" policy.

DO $$
DECLARE
    t_name text;
    p_name text;
BEGIN
    FOR t_name IN SELECT unnest(ARRAY[
        'field_subunits', 'practice_slots', 'game_slots', 'team_players', 
        'practice_assignments', 'games', 'staging_players', 'player_buddies', 
        'scheduler_runs', 'evaluation_criteria', 'evaluation_scores', 
        'evaluation_sessions', 'export_jobs', 'email_log', 'registration_forms', 'registrations'
    ]) LOOP
        IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t_name) THEN
            -- Enable RLS
            EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t_name);
            
            -- Drop all existing policies for this table to start fresh
            FOR p_name IN (SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t_name) LOOP
                EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p_name, t_name);
            END LOOP;

            -- Create the unified org-scoped access policy
            -- This allows simple read/write if the user is a member of the organization.
            -- Note: More granular roles (admin/coach) can be checked within the app if needed, 
            -- but for multi-tenancy, org membership is the primary gate.
            EXECUTE format('CREATE POLICY "org_member_access" ON public.%I FOR SELECT TO authenticated USING (is_org_member(organization_id))', t_name);
        END IF;
    END LOOP;
END$$;

-- 3. SPECIFIC FIX FOR REGISTRATION POLICIES (Task 3)
-- Ensure 'registrations' policy allows users to see their own data OR for admins to see all.
-- Note: The previous loop created a generic 'org_member_access'. We'll refine registrations specifically.

DROP POLICY IF EXISTS "org_member_access" ON public.registrations;

CREATE POLICY "registrations_user_own_or_admin" ON public.registrations
    FOR ALL TO authenticated
    USING (
        profile_id = auth.uid() OR
        (
            is_org_member(organization_id) AND
            EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.profile_id = auth.uid()
                  AND om.organization_id = registrations.organization_id
                  AND om.role = 'admin'
            )
        )
    );

DROP POLICY IF EXISTS "org_member_access" ON public.registration_forms;

CREATE POLICY "registration_forms_member_access" ON public.registration_forms
    FOR SELECT TO authenticated
    USING (is_org_member(organization_id) OR status = 'open');

CREATE POLICY "registration_forms_admin_manage" ON public.registration_forms
    FOR ALL TO authenticated
    USING (
        is_org_member(organization_id) AND
        EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.profile_id = auth.uid()
              AND om.organization_id = registration_forms.organization_id
              AND om.role = 'admin'
        )
    );

COMMIT;
