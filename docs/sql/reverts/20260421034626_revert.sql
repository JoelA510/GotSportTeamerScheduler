-- Revert script for migration 20260421034626_invite_code_system.sql
--
-- USE WITH CAUTION: existing organization_members rows added via invites are
-- preserved (only the invite records disappear). If you also want to remove
-- those memberships, do it as a separate DELETE scoped to what you intend.

DROP FUNCTION IF EXISTS public.redeem_org_invite(text);
DROP FUNCTION IF EXISTS public.create_org_invite(uuid, text, interval);
DROP FUNCTION IF EXISTS public.generate_invite_code();

DROP POLICY IF EXISTS "Invites: admins delete unused" ON public.organization_invites;
DROP POLICY IF EXISTS "Invites: admins view own org" ON public.organization_invites;

DROP TABLE IF EXISTS public.organization_invites;
