-- Smoke checks for 20260611000200_import_gotsport_expanded_mapping.sql

-- 1. finalize_import_job remains SECURITY DEFINER with pinned search_path.
select 'finalize_import_job definer + search_path' as check,
       p.prosecdef as is_security_definer,
       array_to_string(p.proconfig, ',') as config
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finalize_import_job';

-- 2. Body references the new mapping inputs (cheap textual sanity check).
select 'expanded mapping markers' as check,
       (prosrc like '%years_played%')        as maps_years_played,
       (prosrc like '%payment_status%')      as maps_payment_status,
       (prosrc like '%waitlist%')            as maps_waitlist,
       (prosrc like '%guardian_1_first_name%') as maps_guardians,
       (prosrc like '%gender_model%')        as honors_gender_model,
       (prosrc like '%derived_division_name%') as derives_gendered_divisions
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'finalize_import_job';
