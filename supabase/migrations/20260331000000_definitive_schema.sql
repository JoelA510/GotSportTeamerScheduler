-- ==================================================================================
-- DEFINITIVE SCHEMA MIGRATION
-- ==================================================================================
-- This migration creates all tables the SquadLogic app needs, derived from:
-- 1. Mock client table names and fields (frontend/src/lib/supabaseClient.js)
-- 2. Edge Functions and component usage patterns
-- 3. Existing migration files (consolidated and subsequent)
--
-- Strategy:
-- - Create tables in dependency order (orgs → members → hierarchy)
-- - Use uuid for IDs with gen_random_uuid() defaults
-- - Add organization_id to all org-scoped tables for RLS enforcement
-- - Add created_at and updated_at timestamps to all tables
-- - Enable RLS on all tables
-- - Create is_org_member() helper function
-- - Create basic RLS policies for org-based multi-tenancy
-- - Use IF NOT EXISTS and CREATE OR REPLACE for safety
-- ==================================================================================

BEGIN;

-- ==================================================================================
-- TYPES
-- ==================================================================================

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'day_of_week') THEN
        CREATE TYPE day_of_week AS ENUM ('mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun');
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'source_enum') THEN
        CREATE TYPE source_enum AS ENUM ('auto', 'manual');
    END IF;
END$$;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'gender_policy_enum') THEN
        CREATE TYPE gender_policy_enum AS ENUM ('coed', 'girls', 'boys');
    END IF;
END$$;

-- ==================================================================================
-- HELPER FUNCTIONS
-- ==================================================================================

-- Timestamp update trigger
CREATE OR REPLACE FUNCTION trigger_set_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    new.updated_at = timezone('utc', now());
    RETURN new;
END;
$$;

-- Fresh-replay canonicalization:
-- Historical migrations before this point created an interim bigint-based
-- season schema. The canonical app schema below uses UUID primary keys and is
-- what later migrations, pgTAP fixtures, and Edge Functions expect. During a
-- fresh local/CI replay, drop the interim public app tables before rebuilding
-- the definitive schema. Existing environments that already recorded this
-- migration do not re-run it.
DO $$
DECLARE
    table_ident text;
    table_has_rows boolean;
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'season_settings'
          AND column_name = 'id'
          AND data_type = 'bigint'
    ) THEN
        FOR table_ident IN
            SELECT unnest(ARRAY[
                'public.organizations',
                'public.profiles',
                'public.organization_members',
                'public.season_settings',
                'public.divisions',
                'public.locations',
                'public.fields',
                'public.field_subunits',
                'public.players',
                'public.coaches',
                'public.profile_players',
                'public.teams',
                'public.team_players',
                'public.practice_slots',
                'public.practice_assignments',
                'public.game_slots',
                'public.games',
                'public.event_rsvps',
                'public.team_messages',
                'public.registration_forms',
                'public.registrations',
                'public.imports',
                'public.import_jobs',
                'public.staging_players',
                'public.player_buddies',
                'public.export_jobs',
                'public.email_log',
                'public.schedule_evaluations',
                'public.scheduler_runs',
                'public.evaluation_runs',
                'public.evaluation_findings',
                'public.evaluation_metrics',
                'public.evaluation_run_events',
                'public.audit_log'
            ])
        LOOP
            IF to_regclass(table_ident) IS NOT NULL THEN
                EXECUTE format(
                    'SELECT EXISTS (SELECT 1 FROM %s LIMIT 1)',
                    to_regclass(table_ident)
                )
                INTO table_has_rows;

                IF table_has_rows THEN
                    RAISE EXCEPTION
                        'Refusing definitive schema replay reset because % contains data. Run this historical migration chain only against an empty local/CI database, or create a forward data-preserving migration.',
                        table_ident
                        USING ERRCODE = 'P0001';
                END IF;
            END IF;
        END LOOP;

        DROP VIEW IF EXISTS
            public.coach_team_map,
            public.view_org_metrics,
            public.view_compliance_stats,
            public.view_facility_usage,
            public.view_league_standings
        CASCADE;

        DROP TABLE IF EXISTS
            public.audit_log,
            public.evaluation_run_events,
            public.evaluation_metrics,
            public.evaluation_findings,
            public.evaluation_runs,
            public.scheduler_runs,
            public.schedule_evaluations,
            public.email_log,
            public.export_jobs,
            public.player_buddies,
            public.staging_players,
            public.import_jobs,
            public.imports,
            public.registrations,
            public.registration_forms,
            public.team_messages,
            public.event_rsvps,
            public.games,
            public.game_assignments,
            public.game_slots,
            public.practice_assignments,
            public.practice_slots,
            public.team_players,
            public.teams,
            public.profile_players,
            public.coaches,
            public.players,
            public.field_subunits,
            public.fields,
            public.locations,
            public.divisions,
            public.season_settings,
            public.organization_members,
            public.profiles,
            public.organizations
        CASCADE;
    END IF;
END $$;

-- ==================================================================================
-- 1. CORE ORGANIZATION & AUTH TABLES
-- ==================================================================================

-- Organizations (root)
CREATE TABLE IF NOT EXISTS public.organizations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                text NOT NULL,
    slug                text NOT NULL UNIQUE,
    contact_info        jsonb DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER organizations_set_timestamp
    BEFORE UPDATE ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Profiles (linked to auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email               text NOT NULL,
    first_name          text,
    last_name           text,
    full_name           text,
    avatar_url          text,
    organization_id     uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
    role                text DEFAULT 'user',
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER profiles_set_timestamp
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Organization Members (multi-tenancy)
CREATE TABLE IF NOT EXISTS public.organization_members (
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    profile_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role                text NOT NULL CHECK (role IN ('admin', 'coach', 'player', 'parent', 'staff')),
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    PRIMARY KEY (organization_id, profile_id)
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- HELPER FUNCTION: is_org_member
-- ==================================================================================
-- Check if current user is a member of the given organization
CREATE OR REPLACE FUNCTION public.is_org_member(org_id uuid)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM public.organization_members
        WHERE organization_id = org_id
          AND profile_id = auth.uid()
    );
END;
$$;

-- ==================================================================================
-- 2. SEASON & DIVISION TABLES
-- ==================================================================================

CREATE TABLE IF NOT EXISTS public.season_settings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name                text NOT NULL,
    status              text CHECK (status IN ('draft', 'active', 'completed')),
    season_label        text,
    season_year         integer,
    season_start        date,
    season_end          date,
    roster_formula      jsonb DEFAULT '{}'::jsonb,
    daylight_adjustments jsonb DEFAULT '[]'::jsonb,
    exports_config      jsonb DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER season_settings_set_timestamp
    BEFORE UPDATE ON public.season_settings
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.season_settings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.divisions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    season_settings_id  uuid NOT NULL REFERENCES public.season_settings(id) ON DELETE CASCADE,
    name                text NOT NULL,
    gender_policy       gender_policy_enum DEFAULT 'coed',
    max_roster_size     integer,
    play_format         text,
    format              text,
    season_start        date,
    season_end          date,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (season_settings_id, name)
);

CREATE TRIGGER divisions_set_timestamp
    BEFORE UPDATE ON public.divisions
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.divisions ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- 3. FACILITY TABLES
-- ==================================================================================

CREATE TABLE IF NOT EXISTS public.locations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name                text NOT NULL,
    address             text,
    lighting_available  boolean DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (organization_id, name)
);

CREATE TRIGGER locations_set_timestamp
    BEFORE UPDATE ON public.locations
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.fields (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id         uuid NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    name                text NOT NULL,
    surface_type        text,
    size                text,
    supports_halves     boolean DEFAULT false,
    max_age             text,
    priority_rating     integer DEFAULT 1,
    active              boolean DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (location_id, name)
);

CREATE TRIGGER fields_set_timestamp
    BEFORE UPDATE ON public.fields
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.field_subunits (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    field_id            uuid NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
    label               text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (field_id, label)
);

CREATE TRIGGER field_subunits_set_timestamp
    BEFORE UPDATE ON public.field_subunits
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.field_subunits ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- 4. PLAYER & COACH TABLES
-- ==================================================================================

CREATE TABLE IF NOT EXISTS public.players (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    division_id         uuid REFERENCES public.divisions(id) ON DELETE SET NULL,
    team_id             uuid,
    first_name          text NOT NULL,
    last_name           text NOT NULL,
    preferred_name      text,
    external_registration_id text,
    date_of_birth       date,
    grade               text,
    gender              text,
    birth_year          integer,
    skill_tier          text CHECK (skill_tier IN ('novice', 'developing', 'advanced')),
    status              text DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'pending')),
    coach_volunteer     boolean DEFAULT false,
    willing_to_coach    boolean DEFAULT false,
    buddy_request       text,
    guardian_contacts   jsonb DEFAULT '[]'::jsonb,
    mutual_buddy_code   text,
    medical_info        jsonb DEFAULT '{}'::jsonb,
    registration_history jsonb DEFAULT '[]'::jsonb,
    contact_info        jsonb DEFAULT '{}'::jsonb,
    emergency_contacts  jsonb DEFAULT '[]'::jsonb,
    last_imported_at    timestamptz,
    import_source       text,
    location_lat        double precision,
    location_lng        double precision,
    timezone            text,
    flags               jsonb DEFAULT '[]'::jsonb,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER players_set_timestamp
    BEFORE UPDATE ON public.players
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

CREATE INDEX IF NOT EXISTS players_mutual_buddy_code_idx
    ON public.players (mutual_buddy_code) WHERE mutual_buddy_code IS NOT NULL;

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.coaches (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    profile_id          uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    user_id             uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    player_id           uuid REFERENCES public.players(id) ON DELETE SET NULL,
    full_name           text NOT NULL,
    email               text NOT NULL CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    phone               text,
    certifications      jsonb DEFAULT '[]'::jsonb,
    preferred_practice_days day_of_week[],
    preferred_practice_window tsrange,
    can_coach_multiple_teams boolean DEFAULT false,
    status              text DEFAULT 'active' CHECK (status IN ('active', 'pending-confirmation', 'inactive')),
    contact_info        jsonb DEFAULT '{}'::jsonb,
    last_imported_at    timestamptz,
    import_source       text,
    location_lat        double precision,
    location_lng        double precision,
    timezone            text,
    flags               jsonb DEFAULT '[]'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (email),
    UNIQUE (user_id)
);

CREATE TRIGGER coaches_set_timestamp
    BEFORE UPDATE ON public.coaches
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.coaches ENABLE ROW LEVEL SECURITY;

-- Parent-to-Player mapping
CREATE TABLE IF NOT EXISTS public.profile_players (
    profile_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    player_id           uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    PRIMARY KEY (profile_id, player_id)
);

ALTER TABLE public.profile_players ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- 5. TEAM TABLES
-- ==================================================================================

CREATE TABLE IF NOT EXISTS public.teams (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    division_id         uuid NOT NULL REFERENCES public.divisions(id) ON DELETE CASCADE,
    name                text NOT NULL,
    coach_id            uuid REFERENCES public.coaches(id) ON DELETE SET NULL,
    assistant_coach_ids uuid[] DEFAULT '{}'::uuid[],
    practice_slot_id    uuid,
    calendar_token      uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (division_id, name)
);

CREATE TRIGGER teams_set_timestamp
    BEFORE UPDATE ON public.teams
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.team_players (
    team_id             uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    player_id           uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role                text DEFAULT 'player',
    source              source_enum DEFAULT 'auto'::source_enum,
    added_at            timestamptz NOT NULL DEFAULT timezone('utc', now()),
    PRIMARY KEY (team_id, player_id)
);

ALTER TABLE public.team_players ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- 6. PRACTICE TABLES
-- ==================================================================================

CREATE TABLE IF NOT EXISTS public.practice_slots (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    field_id            uuid NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
    field_subunit_id    uuid REFERENCES public.field_subunits(id) ON DELETE CASCADE,
    day_of_week         day_of_week NOT NULL CHECK (day_of_week IN ('mon', 'tue', 'wed', 'thu')),
    start_time          time NOT NULL,
    end_time            time NOT NULL,
    capacity            smallint DEFAULT 1,
    valid_from          date,
    valid_until         date,
    label               text,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT practice_slots_time_check CHECK (end_time > start_time)
);

CREATE TRIGGER practice_slots_set_timestamp
    BEFORE UPDATE ON public.practice_slots
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

CREATE INDEX IF NOT EXISTS practice_slots_lookup_idx
    ON public.practice_slots (day_of_week, start_time);

ALTER TABLE public.practice_slots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.practice_assignments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    team_id             uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    slot_id             uuid REFERENCES public.practice_slots(id) ON DELETE CASCADE,
    practice_slot_id    uuid REFERENCES public.practice_slots(id) ON DELETE CASCADE,
    day_of_week         text,
    start_time          text,
    end_time            text,
    field_id            uuid,
    effective_date_range daterange,
    source              source_enum DEFAULT 'auto'::source_enum,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER practice_assignments_set_timestamp
    BEFORE UPDATE ON public.practice_assignments
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.practice_assignments ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- 7. GAME TABLES
-- ==================================================================================

CREATE TABLE IF NOT EXISTS public.game_slots (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    field_id            uuid NOT NULL REFERENCES public.fields(id) ON DELETE CASCADE,
    division_id         uuid REFERENCES public.divisions(id) ON DELETE SET NULL,
    start                timestamptz,
    "end"               timestamptz,
    slot_date           date,
    start_time          time,
    end_time            time,
    week_index          smallint,
    capacity            smallint DEFAULT 1,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER game_slots_set_timestamp
    BEFORE UPDATE ON public.game_slots
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.game_slots ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.game_assignments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER game_assignments_set_timestamp
    BEFORE UPDATE ON public.game_assignments
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.game_assignments ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.games (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    season_id           uuid REFERENCES public.season_settings(id) ON DELETE SET NULL,
    game_slot_id        uuid UNIQUE REFERENCES public.game_slots(id) ON DELETE CASCADE,
    home_team_id        uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    away_team_id        uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    venue_id            uuid,
    start_time          timestamptz,
    week_index          smallint,
    score_home          smallint,
    score_away          smallint,
    has_conflict        boolean DEFAULT false,
    conflict_reason     text,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    CONSTRAINT games_team_difference CHECK (home_team_id <> away_team_id)
);

CREATE TRIGGER games_set_timestamp
    BEFORE UPDATE ON public.games
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- 8. EVENT RSVP & COMMUNICATION TABLES
-- ==================================================================================

CREATE TABLE IF NOT EXISTS public.event_rsvps (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    team_id             uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    player_id           uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    reference_id        uuid NOT NULL,
    event_type          text NOT NULL CHECK (event_type IN ('game', 'practice')),
    occurrence_date     date NOT NULL,
    status              text NOT NULL CHECK (status IN ('attending', 'declined', 'maybe')),
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (player_id, reference_id, occurrence_date)
);

CREATE TRIGGER event_rsvps_set_timestamp
    BEFORE UPDATE ON public.event_rsvps
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.event_rsvps ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.team_messages (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    team_id             uuid NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    author_id           uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    content             text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.team_messages ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- 9. REGISTRATION & COMPLIANCE TABLES
-- ==================================================================================

CREATE TABLE IF NOT EXISTS public.registration_forms (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title               text NOT NULL,
    description         text,
    season_id           uuid REFERENCES public.season_settings(id) ON DELETE CASCADE,
    fields              jsonb DEFAULT '[]'::jsonb,
    waiver_text         text,
    status              text DEFAULT 'draft' CHECK (status IN ('draft', 'open', 'closed')),
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER registration_forms_set_timestamp
    BEFORE UPDATE ON public.registration_forms
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.registration_forms ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.registrations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    form_id             uuid NOT NULL REFERENCES public.registration_forms(id) ON DELETE CASCADE,
    player_id           uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    profile_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    responses           jsonb DEFAULT '{}'::jsonb,
    waiver_signed       boolean DEFAULT false,
    waiver_signed_at    timestamptz,
    medical_cleared     boolean DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (form_id, player_id)
);

CREATE TRIGGER registrations_set_timestamp
    BEFORE UPDATE ON public.registrations
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- 10. IMPORT & EXPORT TABLES
-- ==================================================================================

CREATE TABLE IF NOT EXISTS public.imports (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id             uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    file_name           text NOT NULL,
    import_type         text NOT NULL CHECK (import_type IN ('players', 'coaches', 'fields')),
    data                jsonb NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.imports ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.import_jobs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    job_type            text NOT NULL CHECK (job_type IN ('registration', 'fields', 'manual')),
    storage_path        text NOT NULL,
    status              text NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'completed_with_warnings', 'needs_fix')),
    started_at          timestamptz DEFAULT timezone('utc', now()),
    completed_at        timestamptz,
    total_rows          integer,
    processed_rows      integer,
    error_summary       jsonb DEFAULT '{}'::jsonb,
    warning_summary     jsonb DEFAULT '{}'::jsonb,
    created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.staging_players (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    import_job_id       uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
    raw_payload         jsonb NOT NULL,
    normalized_payload  jsonb,
    validation_errors   jsonb DEFAULT '[]'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.staging_players ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.player_buddies (
    player_id           uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    buddy_player_id     uuid NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    source_import_job   uuid NOT NULL REFERENCES public.import_jobs(id) ON DELETE CASCADE,
    is_mutual           boolean DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    PRIMARY KEY (player_id, buddy_player_id),
    CONSTRAINT player_buddies_player_ne_buddy CHECK (player_id <> buddy_player_id)
);

ALTER TABLE public.player_buddies ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.export_jobs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    season_settings_id  uuid REFERENCES public.season_settings(id) ON DELETE SET NULL,
    job_type            text NOT NULL CHECK (job_type IN ('master', 'team')),
    status              text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'completed_with_warnings', 'failed')),
    payload             jsonb DEFAULT '{}'::jsonb,
    storage_path        text,
    schema_version      text DEFAULT 'v1',
    error_details       jsonb DEFAULT '{}'::jsonb,
    created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    started_at          timestamptz,
    completed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER export_jobs_set_timestamp
    BEFORE UPDATE ON public.export_jobs
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.export_jobs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.email_log (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    export_job_id       uuid REFERENCES public.export_jobs(id) ON DELETE SET NULL,
    recipient_email     text NOT NULL CHECK (recipient_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'),
    action              text NOT NULL CHECK (action IN ('draft_generated', 'copied', 'sent')),
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- 11. SCHEDULER & EVALUATION TABLES
-- ==================================================================================

CREATE TABLE IF NOT EXISTS public.scheduler_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    season_id           uuid REFERENCES public.season_settings(id) ON DELETE SET NULL,
    season_settings_id  uuid REFERENCES public.season_settings(id) ON DELETE CASCADE,
    run_type            text NOT NULL CHECK (run_type IN ('team', 'practice', 'game')),
    status              text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'completed_with_warnings', 'needs_manual_review', 'failed')),
    parameters          jsonb DEFAULT '{}'::jsonb,
    metrics             jsonb DEFAULT '{}'::jsonb,
    results             jsonb DEFAULT '{}'::jsonb,
    created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    started_at          timestamptz,
    completed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER scheduler_runs_set_timestamp
    BEFORE UPDATE ON public.scheduler_runs
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.scheduler_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.schedule_evaluations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.schedule_evaluations ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.evaluation_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    scheduler_run_id    uuid REFERENCES public.scheduler_runs(id) ON DELETE SET NULL,
    scheduler_run_type  text CHECK (scheduler_run_type IN ('team', 'practice', 'game', 'composite')),
    season_settings_id  uuid REFERENCES public.season_settings(id) ON DELETE SET NULL,
    status              text NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'completed_with_warnings', 'failed')),
    findings_severity   text CHECK (findings_severity IN ('none', 'warnings', 'errors')),
    metrics_summary     jsonb DEFAULT '{}'::jsonb,
    input_snapshot      jsonb DEFAULT '{}'::jsonb,
    auto_fix_summary    jsonb DEFAULT '{}'::jsonb,
    created_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    started_at          timestamptz,
    completed_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE TRIGGER evaluation_runs_set_timestamp
    BEFORE UPDATE ON public.evaluation_runs
    FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();

ALTER TABLE public.evaluation_runs ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.evaluation_findings (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    evaluation_run_id   uuid NOT NULL REFERENCES public.evaluation_runs(id) ON DELETE CASCADE,
    severity            text NOT NULL CHECK (severity IN ('error', 'warning', 'info')),
    finding_code        text NOT NULL,
    description         text NOT NULL,
    affected_entities   jsonb DEFAULT '[]'::jsonb,
    auto_fix_applied    boolean DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.evaluation_findings ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.evaluation_metrics (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    evaluation_run_id   uuid NOT NULL REFERENCES public.evaluation_runs(id) ON DELETE CASCADE,
    metric_key          text NOT NULL,
    metric_value        numeric,
    thresholds          jsonb DEFAULT '{}'::jsonb,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now()),
    UNIQUE (evaluation_run_id, metric_key)
);

ALTER TABLE public.evaluation_metrics ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.evaluation_run_events (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    evaluation_run_id   uuid NOT NULL REFERENCES public.evaluation_runs(id) ON DELETE CASCADE,
    event_type          text NOT NULL CHECK (event_type IN ('auto_fix', 'manual_override', 'note')),
    event_payload       jsonb NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT timezone('utc', now())
);

ALTER TABLE public.evaluation_run_events ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- 12. AUDIT LOG
-- ==================================================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          timestamptz NOT NULL DEFAULT now(),
    user_id             uuid NOT NULL REFERENCES auth.users(id),
    organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    action              text NOT NULL CHECK (action IN (
        'import.started', 'import.completed', 'import.failed',
        'team.saved', 'team.deleted',
        'game.saved', 'game.deleted',
        'practice.saved', 'practice.deleted',
        'registration.submitted', 'registration.approved', 'registration.rejected',
        'calendar.token_rotated',
        'member.invited', 'member.removed', 'member.role_changed',
        'settings.updated',
        'export.started', 'export.completed'
    )),
    resource_type       text,
    resource_id         uuid,
    metadata            jsonb DEFAULT '{}'::jsonb,
    ip_address          inet
);

CREATE INDEX IF NOT EXISTS idx_audit_log_org_created
    ON public.audit_log (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_user_created
    ON public.audit_log (user_id, created_at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ==================================================================================
-- 13. AUDIT LOG HELPER RPC
-- ==================================================================================

CREATE OR REPLACE FUNCTION public.record_audit_event(
    p_organization_id uuid,
    p_action text,
    p_resource_type text DEFAULT NULL,
    p_resource_id uuid DEFAULT NULL,
    p_metadata jsonb DEFAULT '{}'::jsonb,
    p_ip_address inet DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_audit_id uuid;
BEGIN
    INSERT INTO public.audit_log (
        user_id, organization_id, action,
        resource_type, resource_id, metadata, ip_address
    )
    VALUES (
        auth.uid(), p_organization_id, p_action,
        p_resource_type, p_resource_id, p_metadata, p_ip_address
    )
    RETURNING id INTO v_audit_id;

    RETURN v_audit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_audit_event(uuid, text, text, uuid, jsonb, inet)
    TO authenticated;

-- ==================================================================================
-- 14. BASIC RLS POLICIES
-- ==================================================================================

-- Organizations: Admins and members can access their own
CREATE POLICY "Organizations: members can access"
    ON public.organizations FOR SELECT TO authenticated
    USING (is_org_member(id));

-- Profiles: Users can view their own
CREATE POLICY "Profiles: users view own"
    ON public.profiles FOR SELECT TO authenticated
    USING (auth.uid() = id);

CREATE POLICY "Profiles: users update own"
    ON public.profiles FOR UPDATE TO authenticated
    USING (auth.uid() = id);

-- Organization Members: Members can view members of their org
CREATE POLICY "Org Members: view members"
    ON public.organization_members FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

CREATE POLICY "Org Members: admins manage"
    ON public.organization_members FOR ALL TO authenticated
    USING (
        is_org_member(organization_id) AND
        EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.profile_id = auth.uid()
              AND om.organization_id = organization_members.organization_id
              AND om.role = 'admin'
        )
    );

-- Season Settings: Members can access their org's settings
CREATE POLICY "Season Settings: members access"
    ON public.season_settings FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

CREATE POLICY "Season Settings: admins manage"
    ON public.season_settings FOR ALL TO authenticated
    USING (
        is_org_member(organization_id) AND
        EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.profile_id = auth.uid()
              AND om.organization_id = season_settings.organization_id
              AND om.role = 'admin'
        )
    );

-- Divisions: Members can access
CREATE POLICY "Divisions: members access"
    ON public.divisions FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Locations: Members can access
CREATE POLICY "Locations: members access"
    ON public.locations FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Fields: Members can access
CREATE POLICY "Fields: members access"
    ON public.fields FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Field Subunits: Members can access
CREATE POLICY "Field Subunits: members access"
    ON public.field_subunits FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Players: Members can access their org's players
CREATE POLICY "Players: members access"
    ON public.players FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Coaches: Members can access
CREATE POLICY "Coaches: members access"
    ON public.coaches FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Profile Players: Users can view their own mappings
CREATE POLICY "Profile Players: users view own"
    ON public.profile_players FOR SELECT TO authenticated
    USING (profile_id = auth.uid() OR is_org_member(organization_id));

-- Teams: Members can access
CREATE POLICY "Teams: members access"
    ON public.teams FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Team Players: Members can access
CREATE POLICY "Team Players: members access"
    ON public.team_players FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Practice Slots: Members can access
CREATE POLICY "Practice Slots: members access"
    ON public.practice_slots FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Practice Assignments: Members can access
CREATE POLICY "Practice Assignments: members access"
    ON public.practice_assignments FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Game Slots: Members can access
CREATE POLICY "Game Slots: members access"
    ON public.game_slots FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Game Assignments: Members can access
CREATE POLICY "Game Assignments: members access"
    ON public.game_assignments FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Games: Members can access
CREATE POLICY "Games: members access"
    ON public.games FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Event RSVPs: Members can access, parents can manage their own
CREATE POLICY "Event RSVPs: members access"
    ON public.event_rsvps FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

CREATE POLICY "Event RSVPs: parents manage own"
    ON public.event_rsvps FOR ALL TO authenticated
    USING (
        is_org_member(organization_id) AND
        (
            auth.uid() IN (
                SELECT pp.profile_id FROM public.profile_players pp
                WHERE pp.player_id = event_rsvps.player_id
            )
            OR EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.profile_id = auth.uid()
                  AND om.organization_id = event_rsvps.organization_id
                  AND om.role = 'admin'
            )
        )
    );

-- Team Messages: Members can access
CREATE POLICY "Team Messages: members access"
    ON public.team_messages FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Registration Forms: Members can access open forms
CREATE POLICY "Registration Forms: open forms"
    ON public.registration_forms FOR SELECT TO authenticated
    USING (is_org_member(organization_id) OR status = 'open');

CREATE POLICY "Registration Forms: admins manage"
    ON public.registration_forms FOR ALL TO authenticated
    USING (
        is_org_member(organization_id) AND
        EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.profile_id = auth.uid()
              AND om.organization_id = registration_forms.organization_id
              AND om.role = 'admin'
        )
    );

-- Registrations: Users manage their own, admins manage all
CREATE POLICY "Registrations: users own"
    ON public.registrations FOR ALL TO authenticated
    USING (
        (
            profile_id = auth.uid()
            AND is_org_member(organization_id)
        ) OR
        (
            is_org_member(organization_id) AND
            EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.profile_id = auth.uid()
                  AND om.organization_id = registrations.organization_id
                  AND om.role = 'admin'
            )
        )
    )
    WITH CHECK (
        (
            profile_id = auth.uid()
            AND is_org_member(organization_id)
        ) OR
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

-- Imports: Users can view their org's imports
CREATE POLICY "Imports: members access"
    ON public.imports FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Import Jobs: Members can access
CREATE POLICY "Import Jobs: members access"
    ON public.import_jobs FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Staging Players: Members can access
CREATE POLICY "Staging Players: members access"
    ON public.staging_players FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Player Buddies: Members can access
CREATE POLICY "Player Buddies: members access"
    ON public.player_buddies FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Export Jobs: Members can access
CREATE POLICY "Export Jobs: members access"
    ON public.export_jobs FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Email Log: Members can access
CREATE POLICY "Email Log: members access"
    ON public.email_log FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Scheduler Runs: Members can access
CREATE POLICY "Scheduler Runs: members access"
    ON public.scheduler_runs FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Schedule Evaluations: Members can access
CREATE POLICY "Schedule Evaluations: members access"
    ON public.schedule_evaluations FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Evaluation Runs: Members can access
CREATE POLICY "Evaluation Runs: members access"
    ON public.evaluation_runs FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Evaluation Findings: Members can access
CREATE POLICY "Evaluation Findings: members access"
    ON public.evaluation_findings FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Evaluation Metrics: Members can access
CREATE POLICY "Evaluation Metrics: members access"
    ON public.evaluation_metrics FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Evaluation Run Events: Members can access
CREATE POLICY "Evaluation Run Events: members access"
    ON public.evaluation_run_events FOR SELECT TO authenticated
    USING (is_org_member(organization_id));

-- Audit Log: Admins can view org logs
CREATE POLICY "Audit Log: admins view"
    ON public.audit_log FOR SELECT TO authenticated
    USING (
        is_org_member(organization_id) AND
        EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.profile_id = auth.uid()
              AND om.organization_id = audit_log.organization_id
              AND om.role = 'admin'
        )
    );

-- ==================================================================================
-- 14. REPORTING VIEWS
-- ==================================================================================

CREATE OR REPLACE VIEW public.coach_team_map
WITH (security_invoker = true)
AS
SELECT
    c.user_id AS coach_user_id,
    t.id AS team_id
FROM public.coaches c
JOIN public.teams t ON t.coach_id = c.id
WHERE c.user_id IS NOT NULL
UNION
SELECT
    c.user_id AS coach_user_id,
    t.id AS team_id
FROM public.coaches c
JOIN public.teams t ON c.id = ANY(t.assistant_coach_ids)
WHERE c.user_id IS NOT NULL;

CREATE OR REPLACE VIEW public.view_org_metrics
WITH (security_invoker = true)
AS
SELECT
    o.id AS organization_id,
    o.name AS organization_name,
    (SELECT COUNT(p.id) FROM public.players p WHERE p.organization_id = o.id) AS total_players,
    (SELECT COUNT(t.id) FROM public.teams t WHERE t.organization_id = o.id) AS total_teams,
    (SELECT COUNT(om.profile_id) FROM public.organization_members om WHERE om.organization_id = o.id) AS total_users
FROM public.organizations o;

CREATE OR REPLACE VIEW public.view_compliance_stats
WITH (security_invoker = true)
AS
SELECT
    rf.id AS form_id,
    rf.organization_id,
    rf.title AS form_title,
    COUNT(r.id) AS total_registrations,
    COUNT(r.id) FILTER (WHERE r.waiver_signed = true) AS waivers_signed,
    COUNT(r.id) FILTER (WHERE r.medical_cleared = true) AS medical_cleared
FROM public.registration_forms rf
LEFT JOIN public.registrations r ON r.form_id = rf.id
GROUP BY rf.id, rf.organization_id, rf.title;

CREATE OR REPLACE VIEW public.view_facility_usage
WITH (security_invoker = true)
AS
SELECT
    f.id AS field_id,
    f.organization_id,
    f.name AS field_name,
    COUNT(DISTINCT pa.id) AS practice_count,
    COUNT(DISTINCT g.id) AS game_count,
    COUNT(DISTINCT pa.id) + COUNT(DISTINCT g.id) AS total_events
FROM public.fields f
LEFT JOIN public.practice_slots ps ON ps.field_id = f.id
LEFT JOIN public.practice_assignments pa ON pa.practice_slot_id = ps.id
LEFT JOIN public.game_slots gs ON gs.field_id = f.id
LEFT JOIN public.games g ON g.game_slot_id = gs.id
GROUP BY f.id, f.organization_id, f.name;

CREATE OR REPLACE VIEW public.view_league_standings
WITH (security_invoker = true)
AS
WITH game_results AS (
    SELECT
        id AS game_id,
        season_id,
        home_team_id AS team_id,
        score_home AS goals_for,
        score_away AS goals_against,
        CASE WHEN score_home > score_away THEN 1 ELSE 0 END AS win,
        CASE WHEN score_home < score_away THEN 1 ELSE 0 END AS loss,
        CASE WHEN score_home = score_away THEN 1 ELSE 0 END AS draw
    FROM public.games
    WHERE score_home IS NOT NULL AND score_away IS NOT NULL

    UNION ALL

    SELECT
        id AS game_id,
        season_id,
        away_team_id AS team_id,
        score_away AS goals_for,
        score_home AS goals_against,
        CASE WHEN score_away > score_home THEN 1 ELSE 0 END AS win,
        CASE WHEN score_away < score_home THEN 1 ELSE 0 END AS loss,
        CASE WHEN score_away = score_home THEN 1 ELSE 0 END AS draw
    FROM public.games
    WHERE score_home IS NOT NULL AND score_away IS NOT NULL
)
SELECT
    t.id AS team_id,
    t.organization_id,
    t.name AS team_name,
    t.division_id,
    COUNT(gr.game_id) AS games_played,
    COALESCE(SUM(gr.win), 0) AS wins,
    COALESCE(SUM(gr.loss), 0) AS losses,
    COALESCE(SUM(gr.draw), 0) AS draws,
    COALESCE(SUM(gr.goals_for), 0) AS goals_for,
    COALESCE(SUM(gr.goals_against), 0) AS goals_against,
    COALESCE(SUM(gr.goals_for), 0) - COALESCE(SUM(gr.goals_against), 0) AS goal_differential,
    (COALESCE(SUM(gr.win), 0) * 3) + COALESCE(SUM(gr.draw), 0) AS points
FROM public.teams t
LEFT JOIN game_results gr ON gr.team_id = t.id
GROUP BY t.id, t.organization_id, t.name, t.division_id;

GRANT SELECT ON
    public.coach_team_map,
    public.view_org_metrics,
    public.view_compliance_stats,
    public.view_facility_usage,
    public.view_league_standings
TO authenticated;

COMMIT;
