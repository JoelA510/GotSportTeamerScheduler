-- GotSport teaming enablement — additive schema
--
-- Adds the durable columns/tables behind: configurable age cutoff, per-division
-- age bands + birthdate windows, canonical player/coach registration fields, and
-- coach -> child/team links. Everything here is additive and idempotent, so it
-- is safe to run against an existing database (including one with data).
--
-- Revert:  docs/sql/20260530000000_revert.sql
-- Smoke:   docs/sql/20260530000000_smoke.sql

-- 1. season_settings: configurable age-cutoff model (default school-year Aug-Jul).
ALTER TABLE public.season_settings
  ADD COLUMN IF NOT EXISTS age_cutoff_mode text NOT NULL DEFAULT 'school_year_aug_jul';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'season_settings_age_cutoff_mode_check'
  ) THEN
    ALTER TABLE public.season_settings
      ADD CONSTRAINT season_settings_age_cutoff_mode_check
      CHECK (age_cutoff_mode IN ('birth_year', 'school_year_aug_jul'));
  END IF;
END $$;

-- 2. divisions: age band + per-division birthdate window (supports multi-year bands).
ALTER TABLE public.divisions
  ADD COLUMN IF NOT EXISTS min_age integer,
  ADD COLUMN IF NOT EXISTS max_age integer,
  ADD COLUMN IF NOT EXISTS birthdate_start date,
  ADD COLUMN IF NOT EXISTS birthdate_end date;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'divisions_age_band_bounds') THEN
    ALTER TABLE public.divisions
      ADD CONSTRAINT divisions_age_band_bounds
      CHECK (min_age IS NULL OR max_age IS NULL OR min_age <= max_age);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'divisions_birthdate_window_bounds') THEN
    ALTER TABLE public.divisions
      ADD CONSTRAINT divisions_birthdate_window_bounds
      CHECK (birthdate_start IS NULL OR birthdate_end IS NULL OR birthdate_start <= birthdate_end);
  END IF;
END $$;

-- 3. players: canonical registration fields derived by the GotSport canonicalizer.
ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS registration_status text,
  ADD COLUMN IF NOT EXISTS placement_eligible boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS experience_years integer,
  ADD COLUMN IF NOT EXISTS play_up_requested boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS buddy_request_name text;

-- 4. coaches: canonical coach-registration fields + preferred co-coach link.
ALTER TABLE public.coaches
  ADD COLUMN IF NOT EXISTS source_registration_id text,
  ADD COLUMN IF NOT EXISTS requested_division text,
  ADD COLUMN IF NOT EXISTS coaching_years integer,
  ADD COLUMN IF NOT EXISTS coach_registration_ready boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS preferred_co_coach_id uuid REFERENCES public.coaches(id) ON DELETE SET NULL;

-- 5. coach_team_requests: coach -> child / team links (supports multi-team coaches).
CREATE TABLE IF NOT EXISTS public.coach_team_requests (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  coach_id                uuid NOT NULL REFERENCES public.coaches(id) ON DELETE CASCADE,
  player_id               uuid REFERENCES public.players(id) ON DELETE SET NULL,
  slot                    integer NOT NULL DEFAULT 1,
  child_name              text,
  child_gender            text,
  child_birth_date        date,
  playing_up              boolean NOT NULL DEFAULT false,
  preferred_co_coach_name text,
  preferred_co_coach_id   uuid REFERENCES public.coaches(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at              timestamptz NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (coach_id, slot)
);

CREATE INDEX IF NOT EXISTS coach_team_requests_org_idx ON public.coach_team_requests (organization_id);
CREATE INDEX IF NOT EXISTS coach_team_requests_coach_idx ON public.coach_team_requests (coach_id);
CREATE INDEX IF NOT EXISTS coach_team_requests_player_idx ON public.coach_team_requests (player_id);

ALTER TABLE public.coach_team_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'coach_team_requests'
      AND policyname = 'Enforce Org Membership: ALL'
  ) THEN
    CREATE POLICY "Enforce Org Membership: ALL" ON public.coach_team_requests
      FOR ALL TO authenticated
      USING (is_org_member(organization_id))
      WITH CHECK (is_org_member(organization_id));
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'trigger_set_timestamp')
     AND NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'coach_team_requests_set_timestamp') THEN
    CREATE TRIGGER coach_team_requests_set_timestamp
      BEFORE UPDATE ON public.coach_team_requests
      FOR EACH ROW EXECUTE FUNCTION trigger_set_timestamp();
  END IF;
END $$;

COMMENT ON COLUMN public.season_settings.age_cutoff_mode IS
  'Age-group cutoff model: birth_year (calendar) or school_year_aug_jul (Aug 1 cutoff). Default school_year_aug_jul.';
COMMENT ON TABLE public.coach_team_requests IS
  'Coach -> child/team links resolved from GotSport coach registration; drives coach-anchored team generation and multi-team coaching.';
