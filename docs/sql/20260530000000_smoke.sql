-- Smoke checks for 20260530000000_age_cutoff_division_bands_canonical_fields.sql
-- Each query should return a single row with ok = true.

select 'season_settings.age_cutoff_mode' as check, count(*) = 1 as ok
from information_schema.columns
where table_schema = 'public' and table_name = 'season_settings' and column_name = 'age_cutoff_mode';

select 'divisions age band + window' as check, count(*) = 4 as ok
from information_schema.columns
where table_schema = 'public' and table_name = 'divisions'
  and column_name in ('min_age', 'max_age', 'birthdate_start', 'birthdate_end');

select 'players canonical fields' as check, count(*) = 5 as ok
from information_schema.columns
where table_schema = 'public' and table_name = 'players'
  and column_name in ('registration_status', 'placement_eligible', 'experience_years', 'play_up_requested', 'buddy_request_name');

select 'coaches canonical fields' as check, count(*) = 5 as ok
from information_schema.columns
where table_schema = 'public' and table_name = 'coaches'
  and column_name in ('source_registration_id', 'requested_division', 'coaching_years', 'coach_registration_ready', 'preferred_co_coach_id');

select 'coach_team_requests table' as check, to_regclass('public.coach_team_requests') is not null as ok;

select 'coach_team_requests RLS enabled' as check, relrowsecurity as ok
from pg_class where oid = 'public.coach_team_requests'::regclass;

select 'age_cutoff_mode default is school_year_aug_jul' as check,
  column_default like '%school_year_aug_jul%' as ok
from information_schema.columns
where table_schema = 'public' and table_name = 'season_settings' and column_name = 'age_cutoff_mode';
