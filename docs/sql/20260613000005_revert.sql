-- Revert for 20260613000005_crud_review_fixes.sql
DROP FUNCTION IF EXISTS public.get_organization_members(uuid);
DROP FUNCTION IF EXISTS public.admin_create_registration_form(uuid, text, text, uuid, jsonb, text, text, jsonb);

-- Restore the previous function bodies by re-running:
--   admin_update_registration_form  -> 20260613000001_form_mutation_rpcs.sql
--   admin_remove_member             -> 20260613000002_member_mutation_rpcs.sql
--   admin_change_member_role        -> 20260613000002_member_mutation_rpcs.sql
--   admin_create_registration_form  -> 20260504030000_admin_create_registration_form_rpc.sql
