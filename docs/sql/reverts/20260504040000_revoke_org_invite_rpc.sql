-- Emergency rollback for 20260504040000_revoke_org_invite_rpc.sql.
--
-- Pair with an app rollback if the frontend still calls revoke_org_invite.
-- This restores the prior direct-delete RLS policy for unused invites.

BEGIN;

DROP FUNCTION IF EXISTS public.revoke_org_invite(uuid, uuid);

DROP POLICY IF EXISTS "Invites: admins delete unused"
  ON public.organization_invites;
CREATE POLICY "Invites: admins delete unused"
  ON public.organization_invites FOR DELETE
  TO authenticated
  USING (public.is_org_admin(organization_id) AND used_at IS NULL);

COMMENT ON TABLE public.organization_invites IS
  'Single-use invite codes that add an auth.users member to an org with a preset role.';

COMMIT;
