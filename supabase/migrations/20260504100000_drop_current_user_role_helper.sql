-- Drop the legacy JWT-role helper from early RLS drafts.
--
-- Current policies and RPCs use org-scoped helpers:
--   public.is_org_member(uuid)
--   public.is_org_admin(uuid)

DROP FUNCTION IF EXISTS public.current_user_role();
