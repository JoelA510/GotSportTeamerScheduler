BEGIN;

-- Restrict direct writes on trusted materialized buddy relationships.
-- Keep org-member read access, but require org admin for INSERT/UPDATE/DELETE.
DROP POLICY IF EXISTS "org_member_access" ON public.player_buddies;
DROP POLICY IF EXISTS "Unified org access on player_buddies" ON public.player_buddies;
DROP POLICY IF EXISTS "Admins can do everything on player_buddies" ON public.player_buddies;
DROP POLICY IF EXISTS "Player Buddies: members access" ON public.player_buddies;

CREATE POLICY "Player Buddies: members read"
    ON public.player_buddies FOR SELECT TO authenticated
    USING (public.is_org_member(organization_id));

CREATE POLICY "Player Buddies: admin write"
    ON public.player_buddies FOR INSERT TO authenticated
    WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "Player Buddies: admin update"
    ON public.player_buddies FOR UPDATE TO authenticated
    USING (public.is_org_admin(organization_id))
    WITH CHECK (public.is_org_admin(organization_id));

CREATE POLICY "Player Buddies: admin delete"
    ON public.player_buddies FOR DELETE TO authenticated
    USING (public.is_org_admin(organization_id));

COMMIT;
