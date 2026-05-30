-- Revert for 20260530000000_age_cutoff_division_bands_canonical_fields.sql
-- Drops the additive columns/table introduced by that migration. Idempotent.

DROP TABLE IF EXISTS public.coach_team_requests;

ALTER TABLE public.coaches
  DROP COLUMN IF EXISTS source_registration_id,
  DROP COLUMN IF EXISTS requested_division,
  DROP COLUMN IF EXISTS coaching_years,
  DROP COLUMN IF EXISTS coach_registration_ready,
  DROP COLUMN IF EXISTS preferred_co_coach_id;

ALTER TABLE public.players
  DROP COLUMN IF EXISTS registration_status,
  DROP COLUMN IF EXISTS placement_eligible,
  DROP COLUMN IF EXISTS experience_years,
  DROP COLUMN IF EXISTS play_up_requested,
  DROP COLUMN IF EXISTS buddy_request_name;

ALTER TABLE public.divisions
  DROP CONSTRAINT IF EXISTS divisions_age_band_bounds,
  DROP CONSTRAINT IF EXISTS divisions_birthdate_window_bounds,
  DROP COLUMN IF EXISTS min_age,
  DROP COLUMN IF EXISTS max_age,
  DROP COLUMN IF EXISTS birthdate_start,
  DROP COLUMN IF EXISTS birthdate_end;

ALTER TABLE public.season_settings
  DROP CONSTRAINT IF EXISTS season_settings_age_cutoff_mode_check,
  DROP COLUMN IF EXISTS age_cutoff_mode;
