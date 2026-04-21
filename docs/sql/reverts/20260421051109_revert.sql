-- Revert script for migration 20260421051109_add_registration_forms_division.sql
--
-- USE WITH CAUTION:
--   - Dropping registration_forms.division_id orphans any rows whose form
--     was bound to a division. The FK is ON DELETE SET NULL so no cascade
--     happens, but downstream queries that read rf.division_id break.
--   - Restoring the prior submit_registration body requires it to be re-
--     applied from 20260310000003_registrations_rpc.sql or 20260324000003_*.

DROP FUNCTION IF EXISTS public.submit_registration(uuid, uuid, uuid, jsonb, uuid, text, text);
ALTER TABLE public.registration_forms DROP COLUMN IF EXISTS division_id;
