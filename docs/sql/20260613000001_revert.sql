-- Revert for 20260613000001_form_mutation_rpcs.sql
DROP FUNCTION IF EXISTS public.admin_update_registration_form(uuid, jsonb);
DROP FUNCTION IF EXISTS public.admin_delete_registration_form(uuid);

-- Remove audit actions added in this migration from the constraint.
-- Re-run the full constraint block from 20260613000000 to restore prior state.
