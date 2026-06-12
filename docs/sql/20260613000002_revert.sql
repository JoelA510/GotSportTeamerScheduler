-- Revert for 20260613000002_member_mutation_rpcs.sql
DROP FUNCTION IF EXISTS public.admin_remove_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.admin_change_member_role(uuid, uuid, text);
