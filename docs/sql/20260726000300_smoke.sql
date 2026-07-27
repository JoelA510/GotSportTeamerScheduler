-- Smoke checks for 20260726000300_finalize_import_reimport_coalesce.sql

-- 1. finalize_import_job's UPDATE branch now COALESCEs the previously-
--    unconditional fields against the existing row. Expect true for all.
select 'finalize_import_job preserves fields on narrow re-import (expect all true)' as check,
       pg_get_functiondef(p.oid) like '%preferred_name = COALESCE(de.preferred_name, p.preferred_name)%' as preferred_name_coalesced,
       pg_get_functiondef(p.oid) like '%willing_to_coach = COALESCE(de.willing_to_coach, p.willing_to_coach)%' as willing_to_coach_coalesced,
       pg_get_functiondef(p.oid) like '%guardian_contacts = COALESCE(NULLIF(de.guardian_contacts%' as guardian_contacts_protected,
       pg_get_functiondef(p.oid) like '%contact_info = COALESCE(p.contact_info%|| de.contact_info%'
         or pg_get_functiondef(p.oid) like '%contact_info = COALESCE(p.contact_info, ''{}''::jsonb) || de.contact_info%' as contact_info_merged
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'finalize_import_job';

-- 2. finalize_coach_import_job's UPDATE branch now protects
--    certifications/contact_info/custom_attributes the same way. Expect
--    true for all.
select 'finalize_coach_import_job preserves fields on narrow re-import (expect all true)' as check,
       pg_get_functiondef(p.oid) like '%certifications = COALESCE(NULLIF(v_certifications%' as certifications_protected,
       pg_get_functiondef(p.oid) like '%contact_info = COALESCE(v_existing.contact_info%' as contact_info_merged,
       pg_get_functiondef(p.oid) like '%custom_attributes = COALESCE(v_existing.custom_attributes%' as custom_attributes_merged
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'finalize_coach_import_job';

-- 3. Both functions remain SECURITY DEFINER with search_path pinned
--    (unchanged by this migration, sanity check against accidental drop).
--    Expect both rows security_type = 'DEFINER'.
select 'both functions remain SECURITY DEFINER (expect DEFINER for both rows)' as check,
       routine_name, security_type
from information_schema.routines
where routine_schema = 'public'
  and routine_name in ('finalize_import_job', 'finalize_coach_import_job')
order by routine_name;

-- Behavioral (re-import with a narrower CSV preserves guardian_contacts /
-- willing_to_coach / certifications / contact_info / custom_attributes on an
-- existing row; a first import with those columns still sets them; a brand
-- new player/coach with no coaching-interest column still defaults to
-- false, not NULL) verification lives in the pgTAP suite:
-- supabase/tests/finalize_import_reimport_coalesce.sql (run via
-- `npm run test:db`), since it needs staged rows and a real UPDATE/INSERT
-- to observe.
